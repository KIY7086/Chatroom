import json
import os
import sqlite3
import hashlib
from aiohttp import web
import secrets
import time

conn = sqlite3.connect('userdata.db')
c = conn.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS users
             (username TEXT PRIMARY KEY, password TEXT)''')
c.execute('''CREATE TABLE IF NOT EXISTS sessions
             (session_id TEXT PRIMARY KEY, username TEXT, expires REAL)''')
c.execute('''CREATE TABLE IF NOT EXISTS chat_messages
             (id INTEGER PRIMARY KEY, sender TEXT, message TEXT, image TEXT, audio TEXT, file_name TEXT, timestamp REAL)''')
conn.commit()

connected = {}
online_users = set()
message_fragments = {}


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


async def register(request):
    data = await request.json()
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return web.json_response({"success": False, "message": "用户名和密码不能为空"})

    hashed_password = hash_password(password)

    try:
        c.execute("INSERT INTO users (username, password) VALUES (?, ?)", (username, hashed_password))
        conn.commit()
        return web.json_response({"success": True})
    except sqlite3.IntegrityError:
        return web.json_response({"success": False, "message": "用户已存在！"})


async def login(request):
    data = await request.json()
    username = data['username']
    password = hash_password(data['password'])

    c.execute("SELECT * FROM users WHERE username = ? AND password = ?", (username, password))
    if c.fetchone():
        session_id = secrets.token_urlsafe()
        expires = time.time() + 24 * 60 * 60
        c.execute("INSERT INTO sessions (session_id, username, expires) VALUES (?, ?, ?)",
                  (session_id, username, expires))
        conn.commit()
        return web.json_response({"success": True, "session_id": session_id})
    else:
        return web.json_response({"success": False, "message": "用户名或密码错误"})


async def check_session(request):
    session_id = request.cookies.get('session_id')
    if session_id:
        c.execute("SELECT username FROM sessions WHERE session_id = ? AND expires > ?",
                  (session_id, time.time()))
        result = c.fetchone()
        if result:
            return web.json_response({"success": True, "username": result[0]})
    return web.json_response({"success": False})


async def logout(request):
    session_id = request.cookies.get('session_id')
    if session_id:
        c.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        conn.commit()
    return web.json_response({"success": True})


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    username = None

    c.execute("SELECT sender, message, image, audio, file_name, timestamp FROM chat_messages ORDER BY timestamp ASC")
    history_records = c.fetchall()
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

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)

                    if data.get('type') == 'connect':
                        username = data.get('username')
                        if username:
                            connected[username] = ws
                            online_users.add(username)
                            print(f"新用户登录：{username}")
                            await broadcast_user_list()
                        continue

                    if data.get('type') == 'get_user_list':
                        await ws.send_json({
                            'type': 'user_list',
                            'users': list(online_users)
                        })
                        continue

                    if not username:
                        print("错误：未定义用户名的消息")
                        continue

                    timestamp = time.time()
                    message_type = data.get('type')

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
                            c.execute(
                                "INSERT INTO chat_messages (sender, message, image, audio, timestamp) VALUES (?, ?, ?, ?, ?)",
                                (username,
                                 full_message if message_type == 'text' else None,
                                 full_message if message_type == 'image' else None,
                                 full_message if message_type == 'audio' else None,
                                 timestamp))
                            conn.commit()

                            await broadcast(json.dumps({
                                'sender': username,
                                message_type: full_message,
                                'timestamp': timestamp,
                                'type': message_type
                            }))

                            del message_fragments[username][message_type]

                    if message_type == 'file':
                        file_name = data.get('fileName')
                        c.execute("INSERT INTO chat_messages (sender, file_name, timestamp) VALUES (?, ?, ?)",
                                  (username, file_name, timestamp))
                        conn.commit()

                        await broadcast(json.dumps({
                            'sender': username,
                            'fileName': file_name,
                            'timestamp': timestamp,
                            'type': 'file'
                        }))
                    else:
                        message = data.get('message')
                        c.execute("INSERT INTO chat_messages (sender, message, timestamp) VALUES (?, ?, ?)",
                                  (username, message, timestamp))
                        conn.commit()

                        await broadcast(json.dumps({
                            'sender': username,
                            'message': message,
                            'timestamp': timestamp,
                            'type': message_type
                        }))

                except json.JSONDecodeError:
                    print(f"Error decoding JSON: {msg.data}")
                except Exception as e:
                    print(f"Error processing message: {str(e)}")
            elif msg.type == web.WSMsgType.ERROR:
                print(f"WebSocket连接关闭，错误：{ws.exception()}")

    finally:
        if username:
            if username in connected:
                del connected[username]
            if username in online_users:
                online_users.remove(username)
            print(f"用户断开连接：{username}")
            await broadcast_user_list()

    return ws


async def broadcast_user_list():
    user_list = {
        'type': 'user_list',
        'users': list(online_users)
    }
    await broadcast(json.dumps(user_list))


async def broadcast(message):
    for user_ws in connected.values():
        if not user_ws.closed:
            await user_ws.send_str(message)


async def handle_upload(request):
    reader = await request.multipart()

    field = await reader.next()
    assert field.name == 'file'
    filename = field.filename

    os.makedirs('saved_files', exist_ok=True)

    size = 0
    with open(os.path.join('saved_files', filename), 'wb') as f:
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            size += len(chunk)
            f.write(chunk)

    return web.json_response({'success': True, 'message': f'Successfully uploaded {filename}, size: {size} bytes'})


async def download_file(request):
    file_name = request.match_info['file_name']
    file_path = os.path.join('saved_files', file_name)
    if os.path.exists(file_path):
        return web.FileResponse(file_path)
    else:
        return web.Response(status=404, text="File not found")


async def index(request):
    return web.FileResponse('./index.html')

if __name__ == '__main__':
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
    web.run_app(app, host='localhost', port=18080)
