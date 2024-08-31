const STORAGE_KEY_USERNAME = 'chatApp_username';
const STORAGE_KEY_ROOM = 'chatApp_room';
const STORAGE_KEY_SESSION = 'chatApp_session';

const chatApp = {
    socket: null,
    currentUser: null,
    currentRoom: null,
    lastMessageTime: 0,
    mediaRecorder: null,
    isRecording: false,
    audioChunks: [],
    messageQueue: [],
    onlineUsers: [],
    loadingIcon: '<i class="fas fa-spinner fa-spin"></i>'
};

document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    const messageInput = getElementById('messageInput');
    const chatHeader = getElementById('onlineUsers');
    chatHeader.addEventListener('click', requestUserList);
    messageInput.addEventListener('keypress', handleEnterKey);
    adjustAudioContainers();

    const lastUsername = localStorage.getItem(STORAGE_KEY_USERNAME);
    const lastRoom = localStorage.getItem(STORAGE_KEY_ROOM);
    if (lastUsername) {
        getElementById('loginUsername').value = lastUsername;
    }
    if (lastRoom) {
        getElementById('loginRoomNumber').value = lastRoom;
    }

    checkLocalSession();
}

async function checkLocalSession() {
    const sessionId = localStorage.getItem(STORAGE_KEY_SESSION);
    if (sessionId) {
        try {
            const response = await fetch('/check_session', {
                headers: {
                    'Cookie': `session_id=${sessionId}`
                }
            });
            const responseData = await response.json();
            if (responseData.success) {
                chatApp.currentUser = responseData.username;
                chatApp.currentRoom = responseData.roomNumber;
                showChatRoom();
                connectWebSocket();
                updateChatroomTitle(responseData.roomName);
                return;
            }
        } catch (error) {
            console.error('Session check failed:', error);
        }
    }
    showLoginForm();
}

function handleEnterKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
    }
}

function adjustAudioContainers() {
    document.querySelectorAll('.audioContainer').forEach(container => {
        const audio = container.querySelector('audio');
        audio.addEventListener('loadedmetadata', () => {
            container.style.width = `${audio.offsetWidth}px`;
        });
    });
}

function showLoginForm() {
    toggleVisibilityById('loginForm', true);
    toggleVisibilityById('registerForm', false);
}

function showRegisterForm() {
    toggleVisibilityById('loginForm', false);
    toggleVisibilityById('registerForm', true);
}

function showChatRoom() {
    ['loginForm', 'registerForm'].forEach(id => toggleVisibilityById(id, false));
    ['chatRoom', 'logoutBtn', 'onlineUsers'].forEach(id => toggleVisibilityById(id, true));
    getElementById('chatroomTitle').addEventListener('click', editRoomName);
}

async function login() {
    const username = getElementById('loginUsername').value.trim();
    const password = getElementById('loginPassword').value.trim();
    const roomNumber = getElementById('loginRoomNumber').value.trim() || '1';

    if (!username || !password) {
        return showModal("用户名和密码不能为空");
    }

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, roomNumber })
        });

        const responseData = await response.json();
        if (responseData.success) {
            chatApp.currentUser = username;
            chatApp.currentRoom = roomNumber;
            
            localStorage.setItem(STORAGE_KEY_SESSION, responseData.session_id);
            localStorage.setItem(STORAGE_KEY_USERNAME, username);
            localStorage.setItem(STORAGE_KEY_ROOM, roomNumber);

            showChatRoom();
            connectWebSocket();
            updateChatroomTitle(responseData.roomName);
        } else {
            showModal('登录失败：' + responseData.message);
        }
    } catch (error) {
        console.error('登录失败:', error);
        showModal('登录失败，请稍后再试');
    }
}


async function register() {
    const username = getElementById('registerUsername').value.trim();
    const password = getElementById('registerPassword').value.trim();

    if (!username || !password) {
        return showModal('用户名和密码不能为空');
    }

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const responseData = await response.json();
        if (responseData.success) {
            showModal('注册成功！请登录');
            showLoginForm();
        } else {
            showModal('注册失败：' + responseData.message);
        }
    } catch (error) {
        console.error('Error:', error);
        showModal('注册过程中发生错误，请稍后重试');
    }
}

function updateChatroomTitle(roomName) {
    getElementById('chatroomTitle').innerText = roomName;
}

async function logout() {
    try {
        const response = await fetch('/logout', { method: 'POST' });
        const responseData = await response.json();
        if (responseData.success) {
            localStorage.removeItem(STORAGE_KEY_SESSION);
            location.reload();
        }
    } catch (error) {
        console.error('Logout failed:', error);
        showModal('注销失败，请稍后再试');
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = protocol + window.location.host + '/ws';
    console.log('Attempting to connect to WebSocket:', wsUrl);

    chatApp.socket = new WebSocket(wsUrl);

    chatApp.socket.onopen = () => {
        console.log('WebSocket connection established');
        chatApp.socket.send(JSON.stringify({
            type: 'connect',
            username: chatApp.currentUser,
            roomNumber: chatApp.currentRoom
        }));
    };

    chatApp.socket.onmessage = handleSocketMessage;
    chatApp.socket.onerror = handleSocketError;
    chatApp.socket.onclose = handleSocketClose;
}

function handleSocketMessage(event) {
    console.log('Received message:', event.data);
    const responseData = JSON.parse(event.data);
    switch (responseData.type) {
        case 'user_list':
            chatApp.onlineUsers = responseData.users;
            updateOnlineUsers(chatApp.onlineUsers.length);
            break;
        case 'history':
            loadHistoryMessages(Array.isArray(responseData) ? responseData : [responseData]);
            break;
        default:
            handleChunkedMessage(responseData);
    }
}

function handleSocketError(error) {
    console.error('WebSocket error:', error);
    showModal('WebSocket 连接错误，请刷新页面重试');
}

function handleSocketClose(event) {
    console.log('WebSocket connection closed:', event.code, event.reason);
    showModal('WebSocket 连接已关闭，请刷新页面重新连接');
}

function sendMessage() {
    const messageInput = getElementById('messageInput');
    const message = messageInput.value.trim();
    if (message) {
        chatApp.socket.send(JSON.stringify({
            sender: chatApp.currentUser,
            type: 'text',
            message: message,
            roomNumber: chatApp.currentRoom
        }));
        messageInput.value = '';
    }
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        sendFile(file);
    }
}

async function sendFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    console.log('Uploading file:', file);

    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const responseData = await response.json();

        if (responseData.status === 'success') {
            chatApp.socket.send(JSON.stringify({
                sender: chatApp.currentUser,
                fileName: responseData.filename,
                type: 'file',
                roomNumber: chatApp.currentRoom
            }));
        } else {
            console.error('File upload failed:', responseData.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displayMessage(data, isImmediate = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${data.sender === chatApp.currentUser ? 'sent' : 'received'}`;

    if (data.timestamp - chatApp.lastMessageTime > 600) {
        const timeElement = document.createElement('div');
        timeElement.className = 'timestamp';
        timeElement.textContent = new Date(data.timestamp * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        timeElement.style.textAlign = 'center';
        getElementById('chatMessages').appendChild(timeElement);
    }

    let contentHtml = '';
    if (data.sender === chatApp.currentUser) {
        if (data.message) {
            contentHtml = `<div class="message-content">${data.message}</div>`;
        } else if (data.image) {
            contentHtml = `<div class="message-content"><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
        } else if (data.audio) {
            contentHtml = `<div class="audioContainer"><audio src="${data.audio}" controls></audio></div>`;
        } else if (data.fileName) {
            console.log("FileName:", data.fileName);
            contentHtml = `<div class="message-content"><a href="/download/${data.fileName}" style="color: white;" download>[ 文件 ] ${data.fileName}</a></div>`;
        }
    } else {
        if (data.message) {
            contentHtml = `<strong>${data.sender}:</strong><br><div class="message-content"> ${data.message}</div>`;
        } else if (data.image) {
            contentHtml = `<strong>${data.sender}:</strong><br><div class="message-content"><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
        } else if (data.audio) {
            contentHtml = `<strong>${data.sender}:</strong><br><div class="audioContainer"><audio src="${data.audio}" controls></audio></div>`;
        } else if (data.fileName) {
            console.log("FileName:", data.fileName);
            contentHtml = `<strong>${data.sender}:</strong><br><div class="message-content"><a href="/download/${data.fileName}" style="color: black;" download>[ 文件 ] ${data.fileName}</a></div>`;
        }
    }

    messageDiv.innerHTML = contentHtml;
    getElementById('chatMessages').appendChild(messageDiv);
    chatApp.lastMessageTime = data.timestamp;
}

function loadHistoryMessages(messages) {
    messages.forEach(message => {
        displayMessage({
            sender: message.sender,
            message: message.message || '',
            image: message.image || '',
            audio: message.audio || '',
            fileName: message.fileName || '',
            timestamp: message.timestamp,
            type: message.type
        });
    });
}

function toggleRecording() {
    const recordButton = getElementById('recordButton');

    if (!chatApp.isRecording) {
        startRecording();
        recordButton.classList.add('recording');
    } else {
        stopRecording();
        recordButton.classList.remove('recording');
    }
    chatApp.isRecording = !chatApp.isRecording;
}

function updateOnlineUsers(count) {
    getElementById('onlineUsers').textContent = `在线用户：${count}`;
}

function showUserList() {
    showModal(`在线用户列表<br>${chatApp.onlineUsers.join('<br>')}`);
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chatApp.mediaRecorder = new MediaRecorder(stream);

        chatApp.mediaRecorder.ondataavailable = event => chatApp.audioChunks.push(event.data);
        chatApp.mediaRecorder.onstop = sendAudioMessage;

        chatApp.mediaRecorder.start();
    } catch (error) {
        console.error('Error starting recording:', error);
        showModal('无法启动录音，请检查权限或设备');
    }
}

function stopRecording() {
    if (chatApp.mediaRecorder && chatApp.mediaRecorder.state !== 'inactive') {
        chatApp.mediaRecorder.stop();
    }
}

function sendAudio(base64Audio) {
    sendChunkedData('audio', base64Audio);
}

function sendAudioMessage() {
    const audioBlob = new Blob(chatApp.audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = () => sendAudio(reader.result);
    chatApp.audioChunks = [];
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = e => sendImage(e.target.result);
        reader.readAsDataURL(file);
    }
}

function sendChunkedData(type, data, chunkSize = 50000) {
    const chunks = splitIntoChunks(data, chunkSize);
    chunks.forEach((chunk, index) => {
        chatApp.socket.send(JSON.stringify({
            sender: chatApp.currentUser,
            [type]: chunk,
            chunkIndex: index,
            chunkTotal: chunks.length,
            type: type,
            roomNumber: chatApp.currentRoom
        }));
    });
}

function sendImage(base64Image) {
    sendChunkedData('image', base64Image);
}

function showModal(message) {
    const modal = getElementById('modal');
    getElementById('modalMessage').innerHTML = message;
    modal.style.display = 'block';
}

document.querySelector('.close').onclick = () => getElementById('modal').style.display = 'none';
window.onclick = event => {
    if (event.target === getElementById('modal')) {
        getElementById('modal').style.display = 'none';
    }
}

getElementById('logoutBtn').addEventListener('click', logout);

function editRoomName() {
    const chatroomTitle = getElementById('chatroomTitle');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = chatroomTitle.textContent;
    input.classList.add('edit-input');
    chatroomTitle.classList.add('hidden');
    chatroomTitle.parentNode.insertBefore(input, chatroomTitle.nextSibling);
    input.focus();

    input.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            const newName = input.value.trim();
            if (newName) {
                chatroomTitle.textContent = newName;
                chatApp.socket.send(JSON.stringify({
                    type: 'update_room_name',
                    roomNumber: chatApp.currentRoom,
                    newName: newName
                }));
            }
            input.remove();
            chatroomTitle.classList.remove('hidden');
        }
    });

    input.addEventListener('blur', () => {
        chatroomTitle.classList.remove('hidden');
        input.remove();
    });
}

function toggleVisibilityById(id, isVisible) {
    getElementById(id).classList.toggle('hidden', !isVisible);
}

function requestUserList() {
    chatApp.socket.send(JSON.stringify({ type: 'get_user_list' }));
    showUserList();
}

function handleChunkedMessage(data) {
    if (data.chunkIndex !== undefined && data.chunkTotal !== undefined) {
        if (!chatApp.messageQueue[data.sender]) {
            chatApp.messageQueue[data.sender] = {};
        }
        if (!chatApp.messageQueue[data.sender][data.type]) {
            chatApp.messageQueue[data.sender][data.type] = new Array(data.chunkTotal).fill(null);
        }
        chatApp.messageQueue[data.sender][data.type][data.chunkIndex] = data[data.type];
        if (chatApp.messageQueue[data.sender][data.type].every(chunk => chunk !== null)) {
            const fullMessage = chatApp.messageQueue[data.sender][data.type].join('');
            displayMessage({ sender: data.sender, [data.type]: fullMessage, type: data.type, timestamp: data.timestamp });
            delete chatApp.messageQueue[data.sender][data.type];
        }
    } else {
        displayMessage(data, true);
    }
}

function splitIntoChunks(data, chunkSize) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
}

function getElementById(id) {
    return document.getElementById(id);
}

checkSession();
