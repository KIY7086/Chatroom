## KIY7086-Chatroom
一个简单的WebSocket聊天室，使用SQLite存储数据，采用异步架构。
**注意**：目前对SSL的支持不完善，请使用Nginx或Apache反向代理部署外网访问。

### 食用方法
下载源码，在server.py同目录下新建userdata.db数据库文件，然后运行server.py
出现`Running on http://localhost:18080`提示后可以在浏览器访问http://localhost:18080
如果没有反向代理服务可以将server.py的最后一行`host=`改成`localhost`即可使用http://server_ip:18080访问
