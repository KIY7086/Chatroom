import hashlib
import json
import os
import secrets
import time

import aiosqlite
from aiohttp import web
from aiohttp_session import setup, get_session, session_middleware
from aiohttp_session.cookie_storage import EncryptedCookieStorage

DB_PATH_META = 'meta.db'
DB_PATH_DATA = 'data.db'

from datetime import datetime, timezone, timedelta

def format_time():
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).strftime("[%Y-%m-%d %H:%M:%S CST]")

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

    if not username or not password:
        return web.json_response({"success": False, "message": "用户名和密码不能为空"})

    hashed_password = hash_password(password)

    try:
        await meta_db.execute("INSERT INTO users (username, password) VALUES (?, ?)",
                              (username, hashed_password))
        return web.json_response({"success": True})
    except aiosqlite.IntegrityError:
        return web.json_response({"success": False, "message": "用户已存在！"})

async def login(request):
    data = await request.json()
    username = data['username']
    password = hash_password(data['password'])

    result = await meta_db.execute("SELECT 1 FROM users WHERE username = ? AND password = ?",
                                   (username, password))
    if result:
        session = await get_session(request)
        session['username'] = username
        
        rooms = await meta_db.execute("""
            SELECT r.room_number, r.room_name 
            FROM user_rooms ur
            JOIN rooms r ON ur.room_number = r.room_number
            WHERE ur.username = ?
        """, (username,))
        room_list = [{"roomNumber": row[0], "roomName": row[1]} for row in rooms]
        
        return web.json_response({
            "success": True,
            "username": username,
            "rooms": room_list
        })
    else:
        return web.json_response({"success": False, "message": "用户名或密码错误"})

async def add_room(request):
    data = await request.json()
    room_number = data.get('roomNumber')
    room_name = data.get('roomName', f"房间 {room_number}")
    room_password = data.get('roomPassword', '')
    username = data.get('username')

    print(f"{format_time()} 用户 {username} 请求添加房间：{room_number}")

    try:
        room_result = await meta_db.execute("SELECT room_name, room_password FROM rooms WHERE room_number = ?", (room_number,))
        if room_result:
            stored_room_name, stored_password = room_result[0]
            if stored_password == hash_password(room_password) or (stored_password == '' and room_password == ''):
                try:
                    await meta_db.execute("INSERT INTO user_rooms (username, room_number) VALUES (?, ?)", (username, room_number))
                    print(f"{format_time()} 用户 {username} 成功加入已存在的房间 {room_number}")
                    return web.json_response({"success": True, "roomNumber": room_number, "roomName": stored_room_name})
                except aiosqlite.IntegrityError:
                    print(f"{format_time()} 用户 {username} 已经在房间 {room_number} 中")
                    return web.json_response({"success": True, "roomNumber": room_number, "roomName": stored_room_name, "message": "已在房间中"})
            else:
                print(f"{format_time()} 用户 {username} 尝试加入房间 {room_number} 失败：密码错误")
                return web.json_response({"success": False, "message": "密码错误"})
        else:
            print(f"{format_time()} 创建新房间 {room_number}")
            hashed_password = hash_password(room_password) if room_password else ''
            await meta_db.execute("INSERT INTO rooms (room_number, room_name, room_password) VALUES (?, ?, ?)",
                                  (room_number, room_name, hashed_password))
            await meta_db.execute("INSERT INTO user_rooms (username, room_number) VALUES (?, ?)", (username, room_number))
            print(f"{format_time()} 用户 {username} 成功创建并加入新房间 {room_number}")
            return web.json_response({"success": True, "roomNumber": room_number, "roomName": room_name})

    except Exception as e:
        print(f"{format_time()} 添加房间时发生错误：{str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({"success": False, "message": f"添加房间失败：{str(e)}"})


async def check_session(request):
    session = await get_session(request)
    username = session.get('username')
    if username:
        rooms = await meta_db.execute("""
            SELECT r.room_number, r.room_name 
            FROM user_rooms ur
            JOIN rooms r ON ur.room_number = r.room_number
            WHERE ur.username = ?
        """, (username,))
        room_list = [{"roomNumber": row[0], "roomName": row[1]} for row in rooms]
        return web.json_response({
            "success": True, 
            "username": username,
            "rooms": room_list
        })
    return web.json_response({"success": False})


async def logout(request):
    session = await get_session(request)
    session.clear()
    return web.json_response({"success": True})
    

async def get_room_name(request):
    data = await request.json()
    room_number = data.get('roomNumber')
    if room_number:
        room_name_result = await meta_db.execute("SELECT room_name FROM rooms WHERE room_number = ?",
                                                 (room_number,))
        if room_name_result:
            room_name = room_name_result[0][0]
            return web.json_response({"success": True, "roomName": room_name})
    return web.json_response({"success": False, "message": "房间不存在"})

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
                            print(f"{format_time()} 用户：{username}，连接到房间：{room_number}")
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

                            print(
                                f"{format_time()} 用户：{username}，发送了{'图片' if message_type == 'image' else '语音'}")

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

                        print(f"{format_time()} 用户：{username}，发送了文件 {file_name}")

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

                        print(f"{format_time()} 用户：{username}，发送了消息：{message}")

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
            print(f"{format_time()} 用户断开连接：{username}，房间号：{room_number}")
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

async def init_db():
    async with aiosqlite.connect(DB_PATH_META) as db:
        await db.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        );
        ''')
        await db.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            username TEXT,
            expires REAL
        );
        ''')
        await db.execute('''
        CREATE TABLE IF NOT EXISTS rooms (
            room_number TEXT PRIMARY KEY,
            room_name TEXT,
            room_password TEXT
        );
        ''')
        await db.execute('''
        CREATE TABLE IF NOT EXISTS user_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            room_number TEXT,
            UNIQUE(username, room_number)
        );
        ''')
        await db.commit()

        room_check = await db.execute("SELECT 1 FROM rooms WHERE room_number = '1'")
        if not await room_check.fetchone():
            await db.execute("INSERT INTO rooms (room_number, room_name, room_password) VALUES ('1', '公共聊天室', '')")
            await db.commit()

async def get_user_rooms(request):
    data = await request.json()
    username = data.get('username')

    try:
        rooms = await meta_db.execute("""
            SELECT r.room_number, r.room_name 
            FROM user_rooms ur
            JOIN rooms r ON ur.room_number = r.room_number
            WHERE ur.username = ?
        """, (username,))
        room_list = [{"roomNumber": row[0], "roomName": row[1]} for row in rooms]
        return web.json_response({"success": True, "rooms": room_list})
    except Exception as e:
        print(f"获取用户房间列表失败: {str(e)}")
        return web.json_response({"success": False, "message": "获取用户房间列表失败"})

async def download_file(request):
    file_name = request.match_info['file_name']
    file_path = os.path.join('uploads', file_name)
    if os.path.exists(file_path):
        return web.FileResponse(file_path)
    else:
        return web.Response(status=404, text="File not found")

async def index(request):
    return web.FileResponse('./index.html')

async def init_app():
    await init_db()
    app = web.Application()
    
    secret_key = secrets.token_bytes(32)
    setup(app, EncryptedCookieStorage(secret_key))

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
    app.router.add_post('/get_user_rooms', get_user_rooms)
    app.router.add_post('/add_room', add_room)
    app.router.add_post('/get_room_name', get_room_name)

    return app

if __name__ == '__main__':
    web.run_app(init_app(), port=18080)