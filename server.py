import asyncio
import json
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
             (id INTEGER PRIMARY KEY, sender TEXT, message TEXT, image TEXT, audio TEXT, timestamp REAL)''')
conn.commit()

connected = {}
online_users = set()

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
    global online_users_count

    c.execute("SELECT sender, message, image, audio, timestamp FROM chat_messages ORDER BY timestamp ASC")
    history_records = c.fetchall()
    for record in history_records:
        await ws.send_json({
            'sender': record[0],
            'message': record[1],
            'image': record[2],
            'audio': record[3],
            'timestamp': record[4],
            'type': 'history'
        })

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)

                    if 'type' in data and data['type'] == 'connect':
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
                    message = data.get('message')
                    image = data.get('image')
                    audio = data.get('audio')

                    c.execute("INSERT INTO chat_messages (sender, message, image, audio, timestamp) VALUES (?, ?, ?, ?, ?)",
                              (username, message, image, audio, timestamp))
                    conn.commit()

                    await broadcast(json.dumps({
                        'sender': username,
                        'message': message,
                        'image': image,
                        'audio': audio,
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
        if username in connected:
            del connected[username]
            online_users.remove(username)
            print(f"用户断开连接：{username}")
            await broadcast_user_list()
            
    return ws

async def broadcast(message):
    if connected:
        await asyncio.gather(*[client.send_str(message) for client in connected.values()])
        
async def broadcast_user_list():
    message = json.dumps({
        'type': 'user_list',
        'users': list(online_users)
    })
    await broadcast(message)

async def index(request):
    return web.FileResponse('./index.html')

async def favicon(request):
    return web.FileResponse('./favicon.ico')
    
async def style(request):
    return web.FileResponse('./style.css')
    
async def myjs(request):
    return web.FileResponse('./app.js')

app = web.Application()
app.router.add_get('/', index)
app.router.add_post('/register', register)
app.router.add_post('/login', login)
app.router.add_post('/logout', logout)
app.router.add_get('/check_session', check_session)
app.router.add_get('/ws', websocket_handler)
app.router.add_get('/favicon.ico', favicon)
app.router.add_get('/style.css', style)
app.router.add_get('/app.js', myjs)

if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=18080)
