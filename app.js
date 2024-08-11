let socket;
let currentUser;
let lastMessageTime = 0;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let messageQueue = [];
const loadingIcon = '<i class="fas fa-spinner fa-spin"></i>';
window.addEventListener('resize', adjustInputWidth);
document.addEventListener('DOMContentLoaded', adjustInputWidth);

function adjustInputWidth() {
    const imageButton = document.getElementById('imageButton');
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');

    const chatInputWidth = document.querySelector('.chat-input').offsetWidth;
    const totalButtonWidth = imageButton.offsetWidth + sendButton.offsetWidth + 20;

    messageInput.style.width = `${chatInputWidth - totalButtonWidth}px`;
}

function hideOverflowingText() {
    const buttons = document.querySelectorAll('.chat-input button');
    buttons.forEach(button => {
        const icon = button.querySelector('i').outerHTML;
        button.innerHTML = icon;
    });
}

function showButtonText() {
    const buttons = document.querySelectorAll('.chat-input button');
    buttons.forEach(button => {
        const text = button.getAttribute('data-text');
        const icon = button.querySelector('i').outerHTML;
        button.innerHTML = `${icon} ${text}`;
    });
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
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
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
        if (Array.isArray(data)) {
            loadHistoryMessages(data);
        } else {
            displayMessage(data, true);
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
        } else if (data.image || data.audio) {
            contentHtml = `<div class="message-content">${loadingIcon}</div>`;
        }
    } else {
        if (data.message) {
            contentHtml = `<div class="message-content"><strong>${data.sender}:</strong> ${data.message}</div>`;
        } else if (data.image || data.audio) {
            contentHtml = `<div class="message-content"><strong>${data.sender}:</strong> ${loadingIcon}</div>`;
        }
    }
    
    messageDiv.innerHTML = contentHtml;
    document.getElementById('chatMessages').appendChild(messageDiv);
    lastMessageTime = data.timestamp;

    if (!isImmediate && (data.image || data.audio)) {
        messageQueue.push({ div: messageDiv, data: data });
    } else {
        finalizeMessageContent(messageDiv, data);
    }
}

function finalizeMessageContent(messageDiv, data) {
    let contentHtml = '';
    if (data.sender === currentUser) {
        if (data.image) {
            contentHtml = `<div class="message-content"><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
        } else if (data.audio) {
            contentHtml = `<div class="message-content" style="padding-bottom: 1px;padding-top: 5px;padding-left:5px; padding-right:5px; border-radius:50px;"><audio src="${data.audio}" style="max-width: 100%" controls></audio></div>`;
        }
    } else {
        if (data.image) {
            contentHtml = `<div class="message-content"><strong>${data.sender}:</strong><br><img src="${data.image}" style="max-width: 100%; border-radius: 8px;"></div>`;
        } else if (data.audio) {
            contentHtml = `<div class="message-content" style="padding-bottom: 1px;padding-top: 6px;padding-left:5px; padding-right:5px; border-radius:16px 30px 30px 30px;"><strong style="margin-bottom:4px">&nbsp; ${data.sender}</strong><audio src="${data.audio}" style="max-width: 100%" controls></audio></div>`;
        }
    }
    
    if (contentHtml) {
        messageDiv.innerHTML = contentHtml;
    }
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
    messages.forEach(message => displayMessage(message));
    processMessageQueue();
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

function sendAudioMessage() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = function() {
        const base64Audio = reader.result;
        socket.send(JSON.stringify({
            sender: currentUser,
            type: 'audio',
            audio: base64Audio
        }));
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

function sendImage(base64Image) {
    if (socket && base64Image) {
        socket.send(JSON.stringify({ 
            sender: currentUser, 
            image: base64Image,
            type: 'image'
        }));
    }
}

document.addEventListener('DOMContentLoaded', function() {
            const messageInput = document.getElementById('messageInput');
            messageInput.addEventListener('keypress', function(event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    sendMessage();
                }
            });
        });

function showModal(message) {
    const modal = document.getElementById('modal');
    const modalMessage = document.getElementById('modalMessage');
    modalMessage.textContent = message;
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

fetch('/check_session')
.then(response => response.json())
.then(data => {
    if (data.success) {
        currentUser = data.username;
        showChatRoom();
        connectWebSocket();
    }
});