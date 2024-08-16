import json
import os
import aiosqlite
import hashlib
from aiohttp import web
import secrets
import time

DB_PATH_META = 'meta.db'
DB_PATH_DATA = 'data.db'


class Database:
    def __init__(self, db_path):
        self.db_path = db_path

    async def execute(self, query, params=()):
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(query, params) as cursor:
                await db.commit()
                return await cursor.fetchall()

    async def executemany(self, query, params):
        async with aiosqlite.connect(self.db_path) as db:
            async with db.executemany(query, params) as cursor:
                await db.commit()
                return await cursor.fetchall()


meta_db = Database(DB_PATH_META)
data_db = Database(DB_PATH_DATA)

connected = {}
online_users = set()
message_fragments = {}


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


async def register(request):
    data = await request.json()
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    room_number = data.get('roomNumber', '').strip()

    if not username or not password or not room_number:
        return web.json_response({"success": False, "message": "用户名、密码和房间号不能为空"})

    hashed_password = hash_password(password)

    try:
        await meta_db.execute("INSERT INTO users (username, password, room_number) VALUES (?, ?, ?)",
                              (username, hashed_password, room_number))
        return web.json_response({"success": True})
    except aiosqlite.IntegrityError:
        return web.json_response({"success": False, "message": "用户已存在！"})


async def login(request):
    data = await request.json()
    username = data['username']
    password = hash_password(data['password'])

    result = await meta_db.execute("SELECT room_number FROM users WHERE username = ? AND password = ?",
                                   (username, password))
    if result:
        room_number = result[0][0]
        session_id = secrets.token_urlsafe()
        expires = time.time() + 24 * 60 * 60
        await meta_db.execute("INSERT INTO sessions (session_id, username, room_number, expires) VALUES (?, ?, ?, ?)",
                              (session_id, username, room_number, expires))

        room_name_result = await meta_db.execute("SELECT room_name FROM rooms WHERE room_number = ?", (room_number,))
        room_name = room_name_result[0][0] if room_name_result else "聊天室"
        if not room_name_result:
            await meta_db.execute("INSERT INTO rooms (room_number, room_name) VALUES (?, ?)",
                                  (room_number, room_name))

        return web.json_response({"success": True, "session_id": session_id, "roomName": room_name})
    else:
        return web.json_response({"success": False, "message": "用户名或密码错误"})


async def check_session(request):
    session_id = request.cookies.get('session_id')
    if session_id:
        result = await meta_db.execute(
            "SELECT username, room_number FROM sessions WHERE session_id = ? AND expires > ?",
            (session_id, time.time()))
        if result:
            username, room_number = result[0]
            room_name_result = await meta_db.execute("SELECT room_name FROM rooms WHERE room_number = ?",
                                                     (room_number,))
            room_name = room_name_result[0][0]
            return web.json_response(
                {"success": True, "username": username, "roomNumber": room_number, "roomName": room_name})
    return web.json_response({"success": False})


async def logout(request):
    session_id = request.cookies.get('session_id')
    if session_id:
        await meta_db.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    return web.json_response({"success": True})


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    username = None
    room_number = None

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)

                    if data.get('type') == 'connect':
                        username = data.get('username')
                        room_number = data.get('roomNumber')
                        if username and room_number:
                            connected[(username, room_number)] = ws
                            online_users.add((username, room_number))
                            print(f"新用户登录：{username}，房间号：{room_number}")
                            await broadcast_user_list(room_number)

                            await data_db.execute(f"CREATE TABLE IF NOT EXISTS chat_{room_number} "
                                                  "(id INTEGER PRIMARY KEY, sender TEXT, message TEXT, image TEXT, audio TEXT, file_name TEXT, timestamp REAL)")

                            history_records = await data_db.execute(
                                f"SELECT sender, message, image, audio, file_name, timestamp FROM chat_{room_number} ORDER BY timestamp ASC")
                            for record in history_records:
                                history_message = {
                                    'sender': record[0],
                                    'message': record[1],
                                    'image': record[2],
                                    'audio': record[3],
                                    'fileName': record[4],
                                    'timestamp': record[5],
                                    'type': 'history'
                                }
                                await ws.send_json(history_message)
                        continue

                    if data.get('type') == 'get_user_list':
                        await ws.send_json({
                            'type': 'user_list',
                            'users': [user for user, room in online_users if room == room_number]
                        })
                        continue

                    if not username or not room_number:
                        print("错误：未定义用户名或房间号的消息")
                        continue

                    timestamp = time.time()
                    message_type = data.get('type')

                    if message_type == 'update_room_name':
                        new_name = data.get('newName')
                        if new_name:
                            await meta_db.execute("UPDATE rooms SET room_name = ? WHERE room_number = ?",
                                                  (new_name, room_number))
                            await broadcast(json.dumps({
                                'type': 'room_name_updated',
                                'roomNumber': room_number,
                                'newName': new_name
                            }), room_number)
                        continue

                    if 'chunkIndex' in data and 'chunkTotal' in data:
                        message_type = data.get('type')
                        chunk_index = data['chunkIndex']
                        chunk_total = data['chunkTotal']
                        if username not in message_fragments:
                            message_fragments[username] = {}
                        if message_type not in message_fragments[username]:
                            message_fragments[username][message_type] = [None] * chunk_total
                        message_fragments[username][message_type][chunk_index] = data[message_type]
                        if None not in message_fragments[username][message_type]:
                            full_message = ''.join(message_fragments[username][message_type])
                            timestamp = time.time()
                            await data_db.execute(
                                f"INSERT INTO chat_{room_number} (sender, message, image, audio, timestamp) VALUES (?, ?, ?, ?, ?)",
                                (username,
                                 full_message if message_type == 'text' else None,
                                 full_message if message_type == 'image' else None,
                                 full_message if message_type == 'audio' else None,
                                 timestamp))

                            await broadcast(json.dumps({
                                'sender': username,
                                message_type: full_message,
                                'timestamp': timestamp,
                                'type': message_type
                            }), room_number)

                            del message_fragments[username][message_type]

                    if message_type == 'file':
                        file_name = data.get('fileName')
                        await data_db.execute(
                            f"INSERT INTO chat_{room_number} (sender, file_name, timestamp) VALUES (?, ?, ?)",
                            (username, file_name, timestamp))

                        await broadcast(json.dumps({
                            'sender': username,
                            'fileName': file_name,
                            'timestamp': timestamp,
                            'type': 'file'
                        }), room_number)
                    else:
                        message = data.get('message')
                        await data_db.execute(
                            f"INSERT INTO chat_{room_number} (sender, message, timestamp) VALUES (?, ?, ?)",
                            (username, message, timestamp))

                        await broadcast(json.dumps({
                            'sender': username,
                            'message': message,
                            'timestamp': timestamp,
                            'type': message_type
                        }), room_number)

                except json.JSONDecodeError:
                    print(f"Error decoding JSON: {msg.data}")
                except Exception as e:
                    print(f"Error processing message: {str(e)}")
            elif msg.type == web.WSMsgType.ERROR:
                print(f"WebSocket连接关闭，错误：{ws.exception()}")

    finally:
        if username and room_number:
            if (username, room_number) in connected:
                del connected[(username, room_number)]
            if (username, room_number) in online_users:
                online_users.remove((username, room_number))
            print(f"用户断开连接：{username}，房间号：{room_number}")
            await broadcast_user_list(room_number)

    return ws


async def broadcast_user_list(room_number):
    user_list = {
        'type': 'user_list',
        'users': [user for user, room in online_users if room == room_number]
    }
    await broadcast(json.dumps(user_list), room_number)


async def broadcast(message, room_number):
    for (user, room), user_ws in connected.items():
        if room == room_number and not user_ws.closed:
            await user_ws.send_str(message)


async def handle_upload(request):
    reader = await request.multipart()

    field = await reader.next()
    assert field.name == 'file'

    filename = field.filename
    size = 0

    upload_path = os.path.join('uploads', filename)
    os.makedirs(os.path.dirname(upload_path), exist_ok=True)

    with open(upload_path, 'wb') as f:
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            size += len(chunk)
            f.write(chunk)

    return web.json_response({'status': 'success', 'filename': filename, 'size': size})


async def download_file(request):
    file_name = request.match_info['file_name']
    file_path = os.path.join('saved_files', file_name)
    if os.path.exists(file_path):
        return web.FileResponse(file_path)
    else:
        return web.Response(status=404, text="File not found")


async def index(request):
    return web.FileResponse('./index.html')


async def init_app():
    app = web.Application()

    app.router.add_get('/', index)
    app.add_routes([
        web.static('/static', './static'),
        web.static('/fonts', './fonts'),
        web.static('/favicon.ico', './static', show_index=True)
    ])
    app.router.add_post('/register', register)
    app.router.add_post('/login', login)
    app.router.add_post('/logout', logout)
    app.router.add_get('/check_session', check_session)
    app.router.add_get('/ws', websocket_handler)
    app.router.add_get('/download/{file_name}', download_file)
    app.router.add_post('/upload', handle_upload)

    return app


if __name__ == '__main__':
    web.run_app(init_app(), port=18080)
