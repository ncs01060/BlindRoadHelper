document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('webcam');
    const resultImg = document.getElementById('result');
    const startButton = document.getElementById('start-camera');
    const statusText = document.getElementById('status-text');
    const instructionText = document.getElementById('instruction-text');
    const instructionBox = document.getElementById('instruction-box');
    const grayscaleToggle = document.getElementById('toggle-grayscale');
    
    // 네비게이션 정보 요소들
    const navState = document.getElementById('nav-state');
    const navDirection = document.getElementById('nav-direction');
    const navSignal = document.getElementById('nav-signal');
    const navButton = document.getElementById('nav-button');
    const navObstacles = document.getElementById('nav-obstacles');
    
    // 경고 박스 요소들
    const warningBox = document.getElementById('warning-box');
    const warningList = document.getElementById('warning-list');
    
    // 디버깅 정보 요소들
    const debugClasses = document.getElementById('debug-classes');
    const debugBoxes = document.getElementById('debug-boxes');
    const debugMode = document.getElementById('debug-mode');
    const debugStatus = document.getElementById('debug-status');
    
    let isStreaming = false;
    let socket = null;
    let lastRequestTime = 0;
    let pendingRequest = false;
    let captureTimer = null;
    let grayscaleMode = false;
    
    // Socket.IO 연결 설정
    function setupSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        socket = io(`${protocol}//${host}`, {
            transports: ['websocket'],
            upgrade: false,
            reconnectionAttempts: 5,
            timeout: 10000
        });
        
        socket.on('connect', () => {
            statusText.textContent = '서버에 연결되었습니다.';
            statusText.style.color = 'green';
            debugStatus.textContent = '연결됨';
        });
        
        socket.on('disconnect', () => {
            statusText.textContent = '서버 연결이 끊겼습니다.';
            statusText.style.color = 'red';
            debugStatus.textContent = '연결 끊김';
            updateInstruction('서버 연결이 끊겼습니다', 'danger');
        });
        
        socket.on('result', (data) => {
            resultImg.src = data.image;
            pendingRequest = false;
            debugStatus.textContent = '처리 완료';
            
            console.log('🔍 서버 응답 데이터:', data);
            
            // 흑백 모드 상태 동기화
            if (data.hasOwnProperty('grayscale_mode')) {
                updateGrayscaleMode(data.grayscale_mode);
            }
            
            // 네비게이션 정보 업데이트
            updateNavigationInfo(data);
            
            // 디버깅 정보 업데이트
            updateDebugInfo(data);
            
            // 안내 메시지 업데이트
            updateInstructionByNavigationData(data);
            
            const now = Date.now();
            const latency = now - lastRequestTime;
            console.log(`프레임 처리 지연시간: ${latency}ms`);
        });
    }
    
    // 흑백 모드 상태 업데이트
    function updateGrayscaleMode(isGrayscale) {
        grayscaleMode = isGrayscale;
        grayscaleToggle.textContent = grayscaleMode ? '컬러 모드' : '흑백 모드';
        grayscaleToggle.classList.toggle('active', grayscaleMode);
        debugMode.textContent = grayscaleMode ? '흑백' : '컬러';
        console.log(`흑백 모드 상태 변경: ${grayscaleMode ? '활성화됨' : '비활성화됨'}`);
    }
    
    // 네비게이션 정보 업데이트
    function updateNavigationInfo(data) {
        if (!data.navigation) return;
        
        const nav = data.navigation;
        
        // 상태 업데이트
        navState.textContent = getStateText(nav.state);
        navState.style.color = getStateColor(nav.state);
        
        // 방향 업데이트
        navDirection.textContent = getDirectionText(nav.direction);
        navDirection.style.color = getDirectionColor(nav.direction);
        
        // 신호등 정보
        navSignal.textContent = nav.signals.traffic_light ? '감지됨' : '없음';
        navSignal.style.color = nav.signals.traffic_light ? '#4caf50' : '#666';
        
        // 음향 신호기 정보
        navButton.textContent = nav.signals.sound_button ? '감지됨' : '없음';
        navButton.style.color = nav.signals.sound_button ? '#4caf50' : '#666';
        
        // 장애물 정보
        if (nav.obstacles.length > 0) {
            navObstacles.textContent = nav.obstacles.join(', ');
            navObstacles.style.color = '#f44336';
        } else {
            navObstacles.textContent = '없음';
            navObstacles.style.color = '#666';
        }
        
        // 경고 메시지 업데이트
        updateWarnings(nav.warnings);
    }
    
    // 경고 메시지 업데이트
    function updateWarnings(warnings) {
        if (warnings && warnings.length > 0) {
            warningList.innerHTML = '';
            warnings.forEach(warning => {
                const li = document.createElement('li');
                li.textContent = warning;
                warningList.appendChild(li);
            });
            warningBox.classList.remove('hidden');
        } else {
            warningBox.classList.add('hidden');
        }
    }
    
    // 디버깅 정보 업데이트
    function updateDebugInfo(data) {
        if (data.classes && data.classes.length > 0) {
            debugClasses.textContent = data.classes.join(', ');
        } else {
            debugClasses.textContent = '없음';
        }
        
        debugBoxes.textContent = data.boxes ? data.boxes.length : '0';
    }
    
    // 네비게이션 데이터 기반 안내 메시지 업데이트
    function updateInstructionByNavigationData(data) {
        if (!data.navigation) {
            updateInstruction('데이터를 처리하는 중입니다', 'neutral');
            return;
        }
        
        const nav = data.navigation;
        
        // 우선순위 1: 경고 사항
        if (nav.warnings && nav.warnings.length > 0) {
            const primaryWarning = nav.warnings[0];
            updateInstruction(primaryWarning, 'warning');
            return;
        }
        
        // 우선순위 2: 방향 안내
        if (nav.state === 'intersection') {
            if (nav.direction === 'stop') {
                updateInstruction('교차로에서 멈춤 신호입니다', 'danger');
            } else {
                updateInstruction('교차로가 감지되었습니다', 'warning');
            }
        } else if (nav.state === 'straight') {
            if (nav.obstacles.length > 0) {
                updateInstruction('직진 가능하지만 장애물 주의', 'warning');
            } else {
                updateInstruction('직진하세요', 'success');
            }
        } else {
            updateInstruction('경로를 확인하는 중입니다', 'neutral');
        }
    }
    
    // 안내 메시지 업데이트
    function updateInstruction(message, type) {
        instructionText.textContent = message;
        instructionBox.className = `instruction ${type}`;
        
        // 중요한 메시지는 진동으로 알림 (모바일 지원)
        if (type === 'danger' || type === 'warning') {
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
        }
        
        console.log(`안내 메시지 업데이트: ${message} (${type})`);
    }
    
    // 상태 텍스트 변환
    function getStateText(state) {
        switch(state) {
            case 'intersection': return '교차로';
            case 'straight': return '직진';
            case 'unknown': return '알 수 없음';
            default: return state;
        }
    }
    
    // 상태 색상 변환
    function getStateColor(state) {
        switch(state) {
            case 'intersection': return '#ff9800';
            case 'straight': return '#4caf50';
            case 'unknown': return '#666';
            default: return '#666';
        }
    }
    
    // 방향 텍스트 변환
    function getDirectionText(direction) {
        switch(direction) {
            case 'forward': return '앞으로';
            case 'stop': return '멈춤';
            case 'left': return '좌회전';
            case 'right': return '우회전';
            case 'none': return '없음';
            default: return direction;
        }
    }
    
    // 방향 색상 변환
    function getDirectionColor(direction) {
        switch(direction) {
            case 'forward': return '#4caf50';
            case 'stop': return '#f44336';
            case 'left': case 'right': return '#ff9800';
            case 'none': return '#666';
            default: return '#666';
        }
    }
    
    // 카메라 시작 함수
    async function startCamera() {
        try {
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'environment' // 후면 카메라 우선
                }
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            
            video.onloadedmetadata = () => {
                video.play();
                isStreaming = true;
                startButton.textContent = '카메라 중지';
                statusText.textContent = '카메라가 활성화되었습니다.';
                statusText.style.color = 'green';
                debugStatus.textContent = '스트리밍 중';
                
                // 프레임 캡처 시작
                startCapture();
            };
            
        } catch (err) {
            console.error('카메라 접근 오류:', err);
            statusText.textContent = '카메라에 접근할 수 없습니다.';
            statusText.style.color = 'red';
            debugStatus.textContent = '카메라 오류';
            updateInstruction('카메라에 접근할 수 없습니다', 'danger');
        }
    }
    
    // 카메라 중지 함수
    function stopCamera() {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        
        if (captureTimer) {
            clearInterval(captureTimer);
            captureTimer = null;
        }
        
        isStreaming = false;
        startButton.textContent = '카메라 시작';
        statusText.textContent = '카메라가 중지되었습니다.';
        statusText.style.color = 'orange';
        debugStatus.textContent = '중지됨';
        updateInstruction('카메라를 시작하세요', 'neutral');
    }
    
    // 프레임 캡처 시작
    function startCapture() {
        if (captureTimer) {
            clearInterval(captureTimer);
        }
        
        captureTimer = setInterval(() => {
            if (isStreaming && socket && !pendingRequest) {
                captureFrame();
            }
        }, 500); // 0.5초마다 프레임 캡처
    }
    
    // 프레임 캡처 및 전송
    function captureFrame() {
        if (!socket || pendingRequest) return;
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        context.drawImage(video, 0, 0);
        
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        
        pendingRequest = true;
        lastRequestTime = Date.now();
        debugStatus.textContent = '처리 중...';
        
        socket.emit('image', imageData);
    }
    
    // 이벤트 리스너
    startButton.addEventListener('click', () => {
        if (isStreaming) {
            stopCamera();
        } else {
            startCamera();
        }
    });
    
    // 흑백 모드 토글
    grayscaleToggle.addEventListener('click', () => {
        grayscaleMode = !grayscaleMode;
        updateGrayscaleMode(grayscaleMode);
        
        if (socket) {
            socket.emit('toggle_grayscale', grayscaleMode);
        }
    });
    
    // 초기화
    setupSocket();
    updateInstruction('카메라를 시작하세요', 'neutral');
    
    // 페이지 종료 시 정리
    window.addEventListener('beforeunload', () => {
        if (isStreaming) {
            stopCamera();
        }
        if (socket) {
            socket.disconnect();
        }
    });
});
