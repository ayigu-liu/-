import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from backend.websocket_manager import manager
from backend.game_engine import GLOBAL_ROOM_ID

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, player_id: str = Query("")):
    if not player_id:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    await manager.connect(GLOBAL_ROOM_ID, player_id, websocket)

    # 从数据库恢复玩家状态（现金、持仓、冻结等），保证重启不丢失进度
    # 如果是新玩家，load_player_state 不会创建记录，由下面 if 兜底初始化为 STARTING_CASH
    from backend.game_engine import get_global_state, STARTING_CASH, load_player_state
    state = get_global_state()
    await load_player_state(player_id)
    if player_id not in state.players:
        state.players[player_id] = {"nickname": f"玩家{player_id[:4]}", "cash": STARTING_CASH, "frozen_cash": 0, "margin_debt": 0.0}

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type", "")
            msg_data = data.get("data", {})

            if msg_type == "ping":
                ts = 0
                if isinstance(msg_data, dict):
                    ts = msg_data.get("t", 0)
                await manager.send_to(GLOBAL_ROOM_ID, player_id, {"type": "pong", "data": {"t": ts}})

            elif msg_type == "join":
                # Initialize player in global state
                from backend.game_engine import get_global_state, STARTING_CASH, mark_dirty
                from backend.models import User
                from backend.database import async_session
                from sqlalchemy import select
                state = get_global_state()
                nickname = msg_data.get("nickname", f"玩家{player_id[:4]}")
                # 检查是否后台管理员
                is_admin = False
                try:
                    async with async_session() as sess:
                        r = await sess.execute(select(User.is_admin).where(User.id == player_id))
                        is_admin_val = r.scalar_one_or_none()
                        if is_admin_val == 1:
                            is_admin = True
                except Exception:
                    pass
                if player_id not in state.players:
                    cash = STARTING_CASH * 50000 if is_admin else STARTING_CASH  # 后台账号 5亿启动
                    state.players[player_id] = {"nickname": nickname, "cash": cash, "frozen_cash": 0, "margin_debt": 0.0, "is_admin": is_admin}
                else:
                    state.players[player_id]["nickname"] = nickname
                    if is_admin:
                        state.players[player_id]["is_admin"] = True
                        if state.players[player_id]["cash"] < 500_000_000:
                            state.players[player_id]["cash"] = 500_000_000
                mark_dirty(player_id)  # persist nickname to DB
                # Send initial portfolio update using shared function
                from backend.game_engine import calc_player_portfolio
                pf = calc_player_portfolio(state, player_id, pdata, state.holdings.get(player_id, {}))
                await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                    "type": "portfolio_update",
                    "data": {**pf, "is_admin": is_admin},
                })

            elif msg_type == "trade":
                from backend.game_engine import execute_trade
                await execute_trade(player_id, msg_data)

            elif msg_type == "place_order":
                from backend.game_engine import place_limit_order
                await place_limit_order(player_id, msg_data)

            elif msg_type == "cancel_order":
                from backend.game_engine import cancel_limit_order
                await cancel_limit_order(player_id, msg_data)

            elif msg_type == "cancel_all_orders":
                from backend.game_engine import cancel_all_limit_orders
                await cancel_all_limit_orders(player_id)

            elif msg_type == "chat":
                from backend.game_engine import get_global_state
                from datetime import datetime
                state = get_global_state()
                nickname = state.players.get(player_id, {}).get("nickname", player_id[:4])
                message = msg_data.get("message", "").strip()
                if message:
                    await manager.broadcast(GLOBAL_ROOM_ID, {
                        "type": "chat",
                        "data": {
                            "player_id": player_id,
                            "nickname": nickname,
                            "message": message,
                            "time": datetime.now().strftime("%H:%M"),
                        },
                    })

            elif msg_type == "refresh_portfolio":
                from backend.game_engine import get_global_state, calc_player_portfolio
                state = get_global_state()
                pdata = state.players.get(player_id)
                if pdata:
                    pf = calc_player_portfolio(state, player_id, pdata, state.holdings.get(player_id, {}))
                    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                        "type": "portfolio_update",
                        "data": pf,
                    })

    except WebSocketDisconnect:
        from backend.game_engine import save_player_state
        await save_player_state(player_id)
        manager.disconnect(GLOBAL_ROOM_ID, player_id)
    except Exception as e:
        logger.error(f"WS error: {e}")
        from backend.game_engine import save_player_state
        await save_player_state(player_id)
        manager.disconnect(GLOBAL_ROOM_ID, player_id)
