## KIY7086-Chatroom
一个简单的WebSocket聊天室，使用SQLite存储数据，采用异步架构。<br>
**注意**：目前对SSL的支持不完善，请使用Nginx或Apache反向代理部署外网访问。

### 支持的功能
1.普通文字消息<br>
2.语音消息<br>
3.图片消息（支持GIF动图）<br>
4.发送文件<br>
5.多聊天室<br>
6.聊天室列表

### 文件用途
`/uploads`用于储存上传的文件<br>
`/static`用于储存静态文件（CSS，JS等）<br>
`server.py`聊天室后端<br>
`meta.db`储存用户名密码和聊天室<br>
`data.db`储存各聊天室的消息<br>

### 食用方法
下载源码，然后运行server.py<br>
如果有问题尝试新建meta.db和data.db空文件并给予读写权限<br>
出现`Running on http://0.0.0.0:18080`提示后可以在18080端口访问

### 小技巧：
点击聊天室名称可以修改聊天室名称，回车确认<br>
点击聊天室名称下方的`在线用户：`可以查看在线用户列表<br>
