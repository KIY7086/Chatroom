let socket, currentUser, currentRoom, lastMessageTime = 0, mediaRecorder, isRecording = false;
let audioChunks = [], messageQueue = [], onlineUsers = [];
const loadingIcon = '<i class="fas fa-spinner fa-spin"></i>';

document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    const messageInput = document.getElementById('messageInput');
    const chatHeader = document.getElementById('onlineUsers');
    chatHeader.addEventListener('click', requestUserList);
    messageInput.addEventListener('keypress', handleEnterKey);
    adjustAudioContainers();
}

function handleEnterKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
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
    toggleVisibility('loginForm', true);
    toggleVisibility('registerForm', false);
}

function showRegisterForm() {
    toggleVisibility('loginForm', false);
    toggleVisibility('registerForm', true);
}

function showChatRoom() {
    ['loginForm', 'registerForm'].forEach(id => toggleVisibility(id, false));
    ['chatRoom', 'logoutBtn', 'onlineUsers'].forEach(id => toggleVisibility(id, true));
    document.getElementById('chatroomTitle').addEventListener('click', editRoomName);
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showModal("用户名和密码不能为空");
        return;
    }

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });

        const data = await response.json();
        if (data.success) {
            currentUser = username;
            document.cookie = `session_id=${data.session_id}; max-age=${24*60*60}; path=/;`;
            window.location.reload();
        } else {
            showModal('登录失败：' + data.message);
        }
    } catch (error) {
        console.error('登录失败:', error);
        showModal('登录失败，请稍后再试');
    }
}

function updateChatroomTitle(roomName) {
    document.getElementById('chatroomTitle').innerText = roomName;
}

async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    const roomNumber = document.getElementById('registerRoomNumber').value.trim();

    if (!username || !password || !roomNumber) {
        showModal('用户名、密码和房间号不能为空');
        return;
    }

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password, roomNumber})
        });

        const data = await response.json();
        if (data.success) {
            showModal('注册成功！请登录');
            showLoginForm();
        } else {
            showModal('注册失败：' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        showModal('注册过程中发生错误，请稍后重试');
    }
}

async function logout() {
    const response = await fetch('/logout', { method: 'POST' });
    const data = await response.json();
    if (data.success) {
        document.cookie = 'session_id=; max-age=0; path=/;';
        location.reload();
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = protocol + window.location.host + '/ws';
    console.log('Attempting to connect to WebSocket:', wsUrl);

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established');
        socket.send(JSON.stringify({
            type: 'connect',
            username: currentUser,
            roomNumber: currentRoom
        }));
    };

    socket.onmessage = handleSocketMessage;
    socket.onerror = handleSocketError;
    socket.onclose = handleSocketClose;
}

function handleSocketMessage(event) {
    console.log('Received message:', event.data);
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'user_list':
            onlineUsers = data.users;
            updateOnlineUsers(onlineUsers.length);
            break;
        case 'history':
            loadHistoryMessages(Array.isArray(data) ? data : [data]);
            break;
        default:
            handleChunkedMessage(data);
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
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    if (message) {
        socket.send(JSON.stringify({
            sender: currentUser,
            type: 'text',
            message: message,
            roomNumber: currentRoom
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

    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success) {
            socket.send(JSON.stringify({
                sender: currentUser,
                fileName: file.name,
                type: 'file',
                roomNumber: currentRoom
            }));
        } else {
            console.error('File upload failed:', data.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displayMessage(data, isImmediate = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${data.sender === currentUser ? 'sent' : 'received'}`;

    if (data.timestamp - lastMessageTime > 600) {
        const timeElement = document.createElement('div');
        timeElement.className = 'timestamp';
        timeElement.textContent = new Date(data.timestamp * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        timeElement.style.textAlign = 'center';
        document.getElementById('chatMessages').appendChild(timeElement);
    }

    let contentHtml = '';
    if (data.message) {
        contentHtml = `<div class="message-content">${data.message}</div>`;
    } else if (data.image) {
        contentHtml = `<div class="message-content"><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
    } else if (data.audio) {
        contentHtml = `<div class="audioContainer"><audio src="${data.audio}" controls></audio></div>`;
    } else if (data.fileName) {
        contentHtml = `<div class="message-content"><a href="/download/${data.fileName}" style="color: ${data.sender === currentUser ? 'white' : 'black'};" download>[ 文件 ] ${data.fileName}</a></div>`;
    }

    messageDiv.innerHTML = contentHtml;
    document.getElementById('chatMessages').appendChild(messageDiv);
    lastMessageTime = data.timestamp;
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
    const recordButton = document.getElementById('recordButton');

    if (!isRecording) {
        startRecording();
        recordButton.classList.add('recording');
    } else {
        stopRecording();
        recordButton.classList.remove('recording');
    }
    isRecording = !isRecording;
}

function updateOnlineUsers(count) {
    document.getElementById('onlineUsers').textContent = `在线用户：${count}`;
}

function showUserList() {
    showModal(`在线用户列表<br>${onlineUsers.join('<br>')}`);
}

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
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
            type: 'audio',
            roomNumber: currentRoom
        }));
    });
}

function sendAudioMessage() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = () => sendAudio(reader.result);
    audioChunks = [];
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = e => sendImage(e.target.result);
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
            type: 'image',
            roomNumber: currentRoom
        }));
    });
}

function showModal(message) {
    const modal = document.getElementById('modal');
    document.getElementById('modalMessage').innerHTML = message;
    modal.style.display = 'block';
}

document.querySelector('.close').onclick = () => document.getElementById('modal').style.display = 'none';
window.onclick = event => {
    if (event.target == document.getElementById('modal')) {
        document.getElementById('modal').style.display = 'none';
    }
}

document.getElementById('logoutBtn').addEventListener('click', logout);

fetch('/check_session')
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentUser = data.username;
            currentRoom = data.roomNumber;
            showChatRoom();
            connectWebSocket();
            document.getElementById('chatroomTitle').textContent = data.roomName;
        }
    });

function editRoomName() {
    const chatroomTitle = document.getElementById('chatroomTitle');
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
                socket.send(JSON.stringify({
                    type: 'update_room_name',
                    roomNumber: currentRoom,
                    newName: newName
                }));
            } else {
                chatroomTitle.textContent = chatroomTitle.textContent;
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

function toggleVisibility(id, isVisible) {
    document.getElementById(id).classList.toggle('hidden', !isVisible);
}

function requestUserList() {
    socket.send(JSON.stringify({type: 'get_user_list'}));
    showUserList();
}

function handleChunkedMessage(data) {
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
            displayMessage({ sender: data.sender, [data.type]: fullMessage, type: data.type, timestamp: data.timestamp });
            delete messageQueue[data.sender][data.type];
        }
    } else {
        displayMessage(data, true);
    }
}
