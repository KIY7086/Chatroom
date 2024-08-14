let socket;
let currentUser;
let lastMessageTime = 0;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let messageQueue = [];
let onlineUsers = [];
const loadingIcon = '<i class="fas fa-spinner fa-spin"></i>';
window.addEventListener('resize', adjustInputWidth);
document.addEventListener('DOMContentLoaded', adjustInputWidth);

function adjustInputWidth() {
    const imageButton = document.getElementById('imageButton');
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');

    const chatInputWidth = document.querySelector('.chat-input').offsetWidth;
    const totalButtonWidth = imageButton.offsetWidth + sendButton.offsetWidth + 20;
}

function showLoginForm() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
}

function showRegisterForm() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
}

function showChatRoom() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('chatRoom').classList.remove('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
    document.getElementById('onlineUsers').classList.remove('hidden');
}

function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    fetch('/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentUser = username;
            document.cookie = `session_id=${data.session_id}; max-age=${24*60*60}; path=/;`;
            showChatRoom();
            connectWebSocket();
        } else {
            showModal('登录失败：' + data.message);
        }
    });
}

function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    
    if (!username || !password) {
        showModal('用户名和密码不能为空');
        return;
    }
    
    fetch('/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showModal('注册成功！请登录');
            showLoginForm();
        } else {
            showModal('注册失败：' + data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showModal('注册过程中发生错误，请稍后重试');
    });
}

function logout() {
    fetch('/logout', { method: 'POST' })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            document.cookie = 'session_id=; max-age=0; path=/;';
            location.reload();
        }
    });
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = protocol + window.location.host + '/ws';
    console.log('Attempting to connect to WebSocket:', wsUrl);

    socket = new WebSocket(wsUrl);

    socket.onopen = function() {
        console.log('WebSocket connection established');
        socket.send(JSON.stringify({
            type: 'connect',
            username: currentUser
        }));
    };

    socket.onmessage = function(event) {
        console.log('Received message:', event.data);
        const data = JSON.parse(event.data);
        if (data.type === 'user_list') {
            onlineUsers = data.users;
            updateOnlineUsers(onlineUsers.length);
        } else if (data.type === 'history') {
            if (Array.isArray(data)) {
                loadHistoryMessages(data);
            } else {
                loadHistoryMessages([data]);
            }
        } else {
            if (data.chunkIndex !== undefined && data.chunkTotal !== undefined) {
                if (!messageQueue[data.sender]) {
                    messageQueue[data.sender] = {};
                }
                if (!messageQueue[data.sender][data.type]) {
                    messageQueue[data.sender][data.type] = new Array(data.chunkTotal).fill(null);
                }
                messageQueue[data.sender][data.type][data.chunkIndex] = data[data.type];
                if (messageQueue[data.sender][data.type].every(chunk => chunk !== null)) {
                    const fullMessage = messageQueue[data.sender][data.type].join('');
                    if (data.type === 'image') {
                        displayMessage({ sender: data.sender, image: fullMessage, type: 'image', timestamp: data.timestamp });
                    } else if (data.type === 'audio') {
                        displayMessage({ sender: data.sender, audio: fullMessage, type: 'audio', timestamp: data.timestamp });
                    }
                    delete messageQueue[data.sender][data.type];
                }
            } else {
                displayMessage(data, true);
            }
        }
    };


    
    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
        showModal('WebSocket 连接错误，请刷新页面重试');
    };

    socket.onclose = function(event) {
        console.log('WebSocket connection closed:', event.code, event.reason);
        showModal('WebSocket 连接已关闭，请刷新页面重新连接');
    };
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    if (message) {
        socket.send(JSON.stringify({
            sender: currentUser,
            type: 'text',
            message: message
        }));
        messageInput.value = '';
    }
}

function handleFileUpload(event) {
    console.log("File upload triggered");
    const file = event.target.files[0];
    if (file) {
        console.log("File selected:", file.name);
        sendFile(file);
    } else {
        console.log("No file selected");
    }
}

function sendFile(file) {
    console.log("Sending file:", file.name);

    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            socket.send(JSON.stringify({
                sender: currentUser,
                fileName: file.name,
                type: 'file'
            }));
        } else {
            console.error('File upload failed:', data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

function displayMessage(data, isImmediate = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${data.sender === currentUser ? 'sent' : 'received'}`;

    if (data.timestamp - lastMessageTime > 600) {
        const timeElement = document.createElement('div');
        timeElement.className = 'timestamp';
        const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        timeElement.textContent = new Date(data.timestamp * 1000).toLocaleString(undefined, options);
        timeElement.style.textAlign = 'center';
        chatMessages.appendChild(timeElement);
    }

    let contentHtml = '';
    if (data.sender === currentUser) {
        if (data.message) {
            contentHtml = `<div class="message-content">${data.message}</div>`;
        } else if (data.image) {
            contentHtml = `<div class="message-content"><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
        } else if (data.audio) {
            contentHtml = `<div class="message-content" style="padding-bottom: 1px;padding-top: 5px;padding-left:5px; padding-right:5px; border-radius:30px;"><audio src="${data.audio}" style="max-width: 100%" controls></audio></div>`;
        } else if (data.fileName) {
            console.log("FileName:", data.fileName);
            contentHtml = `<div class="message-content"><a href="/download/${data.fileName}" style="color: white;" download>[ 文件 ] ${data.fileName}</a></div>`;
        }
    } else {
        if (data.message) {
            contentHtml = `<div class="message-content"><strong>${data.sender}:</strong> ${data.message}</div>`;
        } else if (data.image) {
            contentHtml = `<div class="message-content"><strong>${data.sender}:</strong><br><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
        } else if (data.audio) {
            contentHtml = `<div class="message-content" style="padding-bottom: 1px;padding-top: 6px;padding-left:5px; padding-right:5px; border-radius:14px 30px 30px 30px;"><strong style="margin-bottom:4px">&nbsp; ${data.sender}</strong><audio src="${data.audio}" style="max-width: 100%" controls></audio></div>`;
        } else if (data.fileName) {
            console.log("FileName:", data.fileName);
            contentHtml = `<div class="message-content"><strong>${data.sender}:</strong> <a href="/download/${data.fileName}" style="color: black;" download>[ 文件 ] ${data.fileName}</a></div>`;
        }
    }

    messageDiv.innerHTML = contentHtml;
    document.getElementById('chatMessages').appendChild(messageDiv);
    lastMessageTime = data.timestamp;
}

function processMessageQueue() {
    if (messageQueue.length === 0) {
        return;
    }

    const item = messageQueue.shift();
    const { div, data } = item;

    if (data.image) {
        const img = new Image();
        img.onload = () => {
            finalizeMessageContent(div, data);
            processMessageQueue();
        };
        img.onerror = () => {
            div.innerHTML = '<div class="message-content">图片加载失败</div>';
            processMessageQueue();
        };
        img.src = data.image;
    } else if (data.audio) {
        const audio = new Audio();
        audio.oncanplaythrough = () => {
            finalizeMessageContent(div, data);
            processMessageQueue();
        };
        audio.onerror = () => {
            div.innerHTML = '<div class="message-content">音频加载失败</div>';
            processMessageQueue();
        };
        audio.src = data.audio;
    } else {
        processMessageQueue();
    }
}

function loadHistoryMessages(messages) {
    if (!Array.isArray(messages)) {
        messages = [messages];
    }

    messages.forEach(message => {
        if (message.type === 'history') {
            if (message.message) {
                displayMessage({
                    sender: message.sender,
                    message: message.message,
                    timestamp: message.timestamp,
                    type: 'text'
                });
            } else if (message.image) {
                displayMessage({
                    sender: message.sender,
                    image: message.image,
                    timestamp: message.timestamp,
                    type: 'image'
                });
            } else if (message.audio) {
                displayMessage({
                    sender: message.sender,
                    audio: message.audio,
                    timestamp: message.timestamp,
                    type: 'audio'
                });
            } else if (message.fileName) {
                displayMessage({
                    sender: message.sender,
                    fileName: message.fileName,
                    timestamp: message.timestamp,
                    type: 'file'
                });
            }
        }
    });
}

function toggleRecording() {
    const recordButton = document.getElementById('recordButton');
    
    if (!isRecording) {
        startRecording();
        recordButton.classList.add('recording');
        isRecording = true;
    } else {
        stopRecording();
        recordButton.classList.remove('recording');
        isRecording = false;
    }
}

function updateOnlineUsers(count) {
    const onlineUsersElement = document.getElementById('onlineUsers');
    if (onlineUsersElement) {
        onlineUsersElement.textContent = `在线用户：${count}`;
    }
}

function showUserList() {
    let userListHTML = '在线用户列表<br>';
    onlineUsers.forEach(user => {
        userListHTML += `${user}<br>`;
    });
    showModal(userListHTML);
}

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = sendAudioMessage;
    
    mediaRecorder.start();
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

function sendAudio(base64Audio) {
    const chunks = splitIntoChunks(base64Audio, 50000);
    chunks.forEach((chunk, index) => {
        socket.send(JSON.stringify({
            sender: currentUser,
            audio: chunk,
            chunkIndex: index,
            chunkTotal: chunks.length,
            type: 'audio'
        }));
    });
}

function sendAudioMessage() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = function() {
        const base64Audio = reader.result;
        sendAudio(base64Audio);
    };
    audioChunks = [];
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64Image = e.target.result;
            sendImage(base64Image);
        };
        reader.readAsDataURL(file);
    }
}

function splitIntoChunks(data, chunkSize) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
}

function sendImage(base64Image) {
    const chunks = splitIntoChunks(base64Image, 50000);
    chunks.forEach((chunk, index) => {
        socket.send(JSON.stringify({
            sender: currentUser,
            image: chunk,
            chunkIndex: index,
            chunkTotal: chunks.length,
            type: 'image'
        }));
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const messageInput = document.getElementById('messageInput');
    messageInput.addEventListener('keypress', handleEnterKey);
});

function handleEnterKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
}

function showModal(message) {
    const modal = document.getElementById('modal');
    const modalMessage = document.getElementById('modalMessage');
    modalMessage.innerHTML = message;
    modal.style.display = 'block';
}

document.querySelector('.close').onclick = function() {
    document.getElementById('modal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('modal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

document.getElementById('logoutBtn').addEventListener('click', logout);

document.addEventListener('DOMContentLoaded', function() {
    const chatHeader = document.getElementById('onlineUsers');
    chatHeader.addEventListener('click', function() {
        socket.send(JSON.stringify({type: 'get_user_list'}));
        showUserList();
    });
});

fetch('/check_session')
.then(response => response.json())
.then(data => {
    if (data.success) {
        currentUser = data.username;
        showChatRoom();
        connectWebSocket();
    }
});