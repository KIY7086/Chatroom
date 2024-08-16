## KIY7086-Chatroom
一个简单的WebSocket聊天室，使用SQLite存储数据，采用异步架构。<br>
**注意**：目前对SSL的支持不完善，请使用Nginx或Apache反向代理部署外网访问。

### 支持的功能
1.普通文字消息<br>
2.语音消息<br>
3.图片消息（支持GIF动图）<br>
4.发送文件<br>
5.多聊天室<br>
6.修改聊天室名称（点击聊天室名称修改，回车确认）
7.在线用户（点击在线用户：`用户数`展示用户列表）<br>
8.Cookie本地存储登录信息

### 文件解释
`/static`储存CSS，JS文件和网站图标<br>
`index.html`聊天室的HTML文件<br>
`server.py`聊天室的后端<br>
`meta.db`储存用户、密码和聊天室<br>
`data.db`储存文字消息以及base64格式的语音和图片<br>

### 食用方法
下载源码，然后运行server.py<br>
如果出错尝试新建data.db和meta.db数据库文件<br>
出现`Running on http://0.0.0.0:18080`提示后可以在18080端口访问网站<br>
