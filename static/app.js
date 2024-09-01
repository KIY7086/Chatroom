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
    loadingIcon: '<i class="fas fa-spinner fa-spin"></i>',
    currentView: null
};

document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    const messageInput = getElementById('messageInput');
    const chatHeader = getElementById('onlineUsers');
    chatHeader.addEventListener('click', requestUserList);
    messageInput.addEventListener('keypress', handleEnterKey);
    adjustAudioContainers();

    const lastUsername = localStorage.getItem(STORAGE_KEY_USERNAME);
    if (lastUsername) {
        getElementById('loginUsername').value = lastUsername;
    }

    checkSession();
}

function updateChatroomTitle(roomName) {
    console.log("Updating chatroom title to:", roomName);
    const titleElement = getElementById('chatroomTitle');
    titleElement.innerText = roomName;
    console.log("Chatroom title updated:", titleElement.innerText);
}


async function checkSession() {
    try {
        const response = await fetch('/check_session', {
            credentials: 'include'
        });
        const responseData = await response.json();
        if (responseData.success) {
            chatApp.currentUser = responseData.username;
            
            // 如果有保存的房间号，尝试加入该房间
            const savedRoomNumber = localStorage.getItem(STORAGE_KEY_ROOM);
            if (savedRoomNumber) {
                const room = responseData.rooms.find(room => room.roomNumber === savedRoomNumber);
                if (room) {
                    chatApp.currentRoom = savedRoomNumber;
                    joinRoom(savedRoomNumber);
                    return;
                }
            }
            
            showRoomList(responseData.rooms);
            return;
        }
    } catch (error) {
        console.error('Session check failed:', error);
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
    updateChatroomTitle('登录');
    toggleVisibilityById('loginForm', true);
    toggleVisibilityById('registerForm', false);
}

function showRegisterForm() {
    updateChatroomTitle('注册');
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

    if (!username || !password) {
        return showModal("用户名和密码不能为空");
    }

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });

        const responseData = await response.json();
        if (responseData.success) {
            chatApp.currentUser = responseData.username;
            localStorage.setItem(STORAGE_KEY_USERNAME, username);
            showRoomList(responseData.rooms);
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

async function logout() {
    try {
        await fetch('/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Logout notification failed:', error);
    }

    localStorage.removeItem(STORAGE_KEY_ROOM);
    localStorage.removeItem('currentView');
    chatApp.currentUser = null;
    chatApp.currentRoom = null;
    chatApp.currentView = null;

    cleanupWebSocket();

    window.location.href = '/';
}


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

function showRoomList(rooms) {
    cleanupWebSocket();
    getElementById('chatroomTitle').removeEventListener('click', editRoomName);
    updateChatroomTitle('选择聊天室');
    console.log("显示房间选择界面");
    toggleVisibilityById('loginForm', false);
    toggleVisibilityById('registerForm', false);
    toggleVisibilityById('chatRoom', false);
    toggleVisibilityById('roomList', true);
    toggleVisibilityById('backToRoomListBtn', false);
    toggleVisibilityById('logoutBtn', true);

    getElementById('chatMessages').innerHTML = '';

    chatApp.currentView = 'roomList';
    localStorage.setItem('currentView', 'roomList');

    const roomsContainer = getElementById('rooms');
    roomsContainer.innerHTML = '';

    fetchRoomList()
}

async function fetchRoomList() {
    console.log("请求获取用户房间列表");

    try {
        const response = await fetch('/get_user_rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: chatApp.currentUser })
        });
        const responseData = await response.json();
        console.log("获取用户房间列表响应:", responseData);

        if (responseData.success) {
            const roomsContainer = getElementById('rooms');
            roomsContainer.innerHTML = '';

            responseData.rooms.forEach(room => {
                console.log("显示房间：", room.roomName);

                const roomDiv = document.createElement('div');
                roomDiv.className = 'room-item';
                roomDiv.innerText = room.roomName;
                roomDiv.onclick = () => joinRoom(room.roomNumber);
                roomsContainer.appendChild(roomDiv);
            });

        } else {
            console.log("无法获取用户房间列表，请稍后再试");
            showModal('无法获取用户房间列表，请稍后再试');
        }
    } catch (error) {
        console.error('获取用户房间列表失败:', error);
        showModal('获取用户房间列表失败，请稍后再试');
    }
}

async function joinRoom(roomNumber) {
    console.log("用户尝试加入房间：", roomNumber);

    cleanupWebSocket();

    toggleVisibilityById('roomList', false);
    toggleVisibilityById('loginForm', false);
    toggleVisibilityById('chatRoom', true);
    toggleVisibilityById('backToRoomListBtn', true);
    toggleVisibilityById('logoutBtn', true);

    chatApp.currentRoom = roomNumber;
    localStorage.setItem(STORAGE_KEY_ROOM, roomNumber);

    chatApp.currentView = 'chatRoom';
    localStorage.setItem('currentView', 'chatRoom');

    updateChatroomTitle("加载中...");

    connectWebSocket();

    getElementById('chatroomTitle').addEventListener('click', editRoomName);
    console.log("房间加入过程完成");

    getElementById('chatMessages').innerHTML = '';
}

async function addRoom() {
    const { value: formValues } = await Swal.fire({
        title: '添加房间',
        html: `
            <input id="swal-input1" class="swal2-input" placeholder="请输入房间号" 
                   style="text-align: left; width: calc(100% - 1rem); margin: 0 0 15px 0; overflow: hidden;">
            <input id="swal-input2" class="swal2-input" placeholder="请输入房间密码（可选）" 
                   style="text-align: left; width: calc(100% - 1rem); margin: 0; overflow: hidden;">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        heightAuto: false,
        preConfirm: () => {
            return [
                document.getElementById('swal-input1').value,
                document.getElementById('swal-input2').value
            ]
        }
    });

    if (!formValues) {
        console.log("用户取消了房间添加");
        return;
    }

    const [roomNumber, roomPassword] = formValues;
    console.log("用户尝试添加房间：", roomNumber);

    if (!roomNumber) {
        console.log("房间号为空，无法添加房间");
        Swal.fire({
            title: '错误',
            text: '房间号不能为空',
            icon: 'error',
            heightAuto: false
        });
        return;
    }

    try {
        const response = await fetch('/add_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                roomNumber, 
                roomPassword,
                username: chatApp.currentUser
            })
        });

        const responseData = await response.json();
        console.log("添加房间请求响应：", responseData);

        if (responseData.success) {
            console.log("成功添加房间：", responseData.roomNumber);
            Swal.fire({
                title: '成功',
                text: '房间已成功添加到列表',
                icon: 'success',
                heightAuto: false
            });
            
            fetchRoomList();
        } else {
            console.log("添加房间失败：", responseData.message);
            Swal.fire({
                title: '失败',
                text: '添加房间失败：' + responseData.message,
                icon: 'error',
                heightAuto: false
            });
        }
    } catch (error) {
        console.error('添加房间失败:', error);
        Swal.fire({
            title: '错误',
            text: '添加房间失败，请稍后再试',
            icon: 'error',
            heightAuto: false
        });
    }
}

async function getRoomName(roomNumber) {
    try {
        const response = await fetch('/get_room_name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomNumber: roomNumber })
        });
        const data = await response.json();
        if (data.success) {
            updateChatroomTitle(data.roomName);
        } else {
            console.error('获取房间名称失败:', data.message);
        }
    } catch (error) {
        console.error('获取房间名称时发生错误:', error);
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = protocol + window.location.host + '/ws';
    console.log('尝试连接到 WebSocket:', wsUrl);

    chatApp.socket = new WebSocket(wsUrl);

    chatApp.socket.onopen = () => {
        console.log('WebSocket 连接已建立');
        getRoomName(chatApp.currentRoom);
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

function cleanupWebSocket() {
    console.log("开始清理 WebSocket 连接");

    if (chatApp.socket) {
        if (chatApp.socket.readyState === WebSocket.OPEN) {
            console.log("关闭现有的 WebSocket 连接");
            chatApp.socket.close();
        } else {
            console.log("WebSocket 连接不处于打开状态，无需关闭");
        }
        chatApp.socket = null;
    } else {
        console.log("没有活动的 WebSocket 连接需要清理");
    }

    chatApp.currentRoom = null;
    chatApp.lastMessageTime = 0;
    chatApp.messageQueue = [];
    chatApp.onlineUsers = [];

    console.log("WebSocket 清理完成");
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

function handleSocketClose() {
    console.log("WebSocket 连接已关闭");
    updateChatroomTitle('选择聊天室');
    setTimeout(connectWebSocket, 5000);
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

async function getRoomName(roomNumber) {
    try {
        const response = await fetch('/get_room_name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomNumber: roomNumber })
        });
        const data = await response.json();
        if (data.success) {
            updateChatroomTitle(data.roomName);
        } else {
            console.error('获取房间名称失败:', data.message);
        }
    } catch (error) {
        console.error('获取房间名称时发生错误:', error);
    }
}

function showModal(message) {
    Swal.fire({
        title: '提示',
        text: message,
        icon: 'info',
        confirmButtonText: '确定',
        heightAuto: false
    });
}

getElementById('logoutBtn').addEventListener('click', logout);

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

function toggleVisibilityById(id, isVisible) {
    document.getElementById(id).classList.toggle('hidden', !isVisible);
}
