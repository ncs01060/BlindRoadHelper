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
    
    // 캔버스 오버레이 요소들
    let overlayCanvas = null;
    let overlayContext = null;
    
    let isStreaming = false;
    let socket = null;
    let lastRequestTime = 0;
    let pendingRequest = false;
    let captureTimer = null;
    let grayscaleMode = false;
    
    // 바운딩 박스와 네비게이션 데이터 저장
    let currentBoxes = [];
    let currentBoxData = []; // 클래스 정보가 포함된 박스 데이터
    let currentNavigation = null;
    let currentArrows = null; // 화살표 정보 저장
    let renderTimer = null;
    
    function speak(text) {
        speechSynthesis.resume(); // 음성 예열
    const testUtterance = new SpeechSynthesisUtterance(text);
    testUtterance.lang = 'ko-KR';
    speechSynthesis.speak(testUtterance);

    }
    function cancel_the_speak() {
        speechSynthesis.cancel();
    }

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
            // 이미지는 더 이상 표시하지 않음 (실시간 카메라 사용)
            pendingRequest = false;
            debugStatus.textContent = '처리 완료';
            
            console.log('🔍 서버 응답 데이터:', data);
            
            // 흑백 모드 상태 동기화
            if (data.hasOwnProperty('grayscale_mode')) {
                updateGrayscaleMode(data.grayscale_mode);
            }
            
            // 바운딩 박스 데이터 업데이트
            if (data.box_coords) {
                currentBoxes = data.box_coords;
            }
            if (data.boxes) {
                currentBoxData = data.boxes; // 클래스 정보가 포함된 전체 박스 데이터
                currentBoxes = data.boxes.map(box => box.box); // 좌표만 추출 (호환성 유지)
            }
            
            // 네비게이션 정보 저장 및 업데이트
            if (data.navigation) {
                currentNavigation = data.navigation;
            }
            
            // 화살표 정보 저장
            if (data.arrows) {
                currentArrows = data.arrows;
                console.log('화살표 정보 업데이트:', currentArrows);
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
    
    // 캔버스 오버레이 생성 함수
    function createOverlayCanvas() {
        if (overlayCanvas) {
            overlayCanvas.remove();
        }
        
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.style.position = 'absolute';
        overlayCanvas.style.top = '0';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.zIndex = '10';
        overlayCanvas.style.borderRadius = '10px';
        
        // 카메라 컨테이너에 캔버스 추가
        const cameraContainer = document.querySelector('.camera-container');
        if (cameraContainer) {
            cameraContainer.style.position = 'relative';
            cameraContainer.appendChild(overlayCanvas);
        } else {
            // 백업: 비디오 부모에 추가
            video.parentNode.style.position = 'relative';
            video.parentNode.appendChild(overlayCanvas);
        }
        
        overlayContext = overlayCanvas.getContext('2d');
        
        // 캔버스 크기를 비디오에 맞춤
        resizeOverlayCanvas();
    }
    
    // 오버레이 캔버스 크기 조정
    function resizeOverlayCanvas() {
        if (!overlayCanvas || !video) return;
        
        // 비디오가 로드될 때까지 대기
        if (video.videoWidth === 0 || video.videoHeight === 0) {
            setTimeout(resizeOverlayCanvas, 100);
            return;
        }
        
        const rect = video.getBoundingClientRect();
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        overlayCanvas.style.width = rect.width + 'px';
        overlayCanvas.style.height = rect.height + 'px';
        
        console.log(`캔버스 크기 조정: ${overlayCanvas.width}x${overlayCanvas.height} -> ${rect.width}x${rect.height}`);
    }
    
    // 바운딩 박스와 화살표 렌더링
    function renderOverlay() {
        if (!overlayContext || !overlayCanvas) return;
        
        // 캔버스 지우기
        overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        
        // 바운딩 박스 그리기
        if (currentBoxes && currentBoxes.length > 0) {
            drawBoundingBoxes();
        }
        
        // 네비게이션 화살표 그리기
        if (currentArrows && currentArrows.arrows && currentArrows.arrows.length > 0) {
            drawNavigationArrows();
        }
        
        // 디버깅: 캔버스에 테스트 점 그리기
        overlayContext.fillStyle = '#FF0000';
        overlayContext.fillRect(10, 10, 5, 5);
    }
    
    // 바운딩 박스 그리기
    function drawBoundingBoxes() {
        if (!video.videoWidth || !video.videoHeight) return;
        
        const scaleX = overlayCanvas.width / video.videoWidth;
        const scaleY = overlayCanvas.height / video.videoHeight;
        
        console.log(`바운딩 박스 그리기: ${currentBoxes.length}개, 스케일: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);
        
        // currentBoxData가 있으면 클래스 정보와 함께 그리기
        if (currentBoxData && currentBoxData.length > 0) {
            currentBoxData.forEach((boxInfo, index) => {
                if (boxInfo && boxInfo.box && boxInfo.box.length >= 4) {
                    const [x1, y1, x2, y2] = boxInfo.box;
                    
                    // 좌표 스케일링
                    const scaledX1 = x1 * scaleX;
                    const scaledY1 = y1 * scaleY;
                    const scaledX2 = x2 * scaleX;
                    const scaledY2 = y2 * scaleY;
                    
                    // 모델별 색상 결정
                    overlayContext.strokeStyle = getModelColor(boxInfo.model);
                    overlayContext.lineWidth = 3;
                    overlayContext.strokeRect(scaledX1, scaledY1, scaledX2 - scaledX1, scaledY2 - scaledY1);
                    
                    // 클래스 이름과 신뢰도 표시
                    const className = getDisplayName(boxInfo.class);
                    const confidence = boxInfo.confidence ? (boxInfo.confidence * 100).toFixed(1) : '';
                    const label = confidence ? `${className} (${confidence}%)` : className;
                    
                    // 라벨 배경 그리기
                    overlayContext.fillStyle = getModelColor(boxInfo.model);
                    overlayContext.font = 'bold 14px Arial';
                    const textMetrics = overlayContext.measureText(label);
                    const textWidth = textMetrics.width + 8;
                    const textHeight = 20;
                    
                    overlayContext.fillRect(scaledX1, scaledY1 - textHeight, textWidth, textHeight);
                    
                    // 라벨 텍스트 그리기 (모델별 적절한 색상 사용)
                    overlayContext.fillStyle = getTextColor(boxInfo.model);
                    overlayContext.fillText(label, scaledX1 + 4, scaledY1 - 6);
                    
                    console.log(`박스 ${index}: ${className} [${x1}, ${y1}, ${x2}, ${y2}] -> [${scaledX1.toFixed(1)}, ${scaledY1.toFixed(1)}, ${scaledX2.toFixed(1)}, ${scaledY2.toFixed(1)}]`);
                }
            });
        } else {
            // 백업: 좌표만 있는 경우
            currentBoxes.forEach((box, index) => {
                if (box && box.length >= 4) {
                    const [x1, y1, x2, y2] = box;
                    
                    // 좌표 스케일링
                    const scaledX1 = x1 * scaleX;
                    const scaledY1 = y1 * scaleY;
                    const scaledX2 = x2 * scaleX;
                    const scaledY2 = y2 * scaleY;
                    
                    // 박스 색상 결정 (모델별로 다른 색상)
                    overlayContext.strokeStyle = getBoundingBoxColor(index);
                    overlayContext.lineWidth = 3;
                    overlayContext.strokeRect(scaledX1, scaledY1, scaledX2 - scaledX1, scaledY2 - scaledY1);
                    
                    // 라벨 표시
                    const boxColor = getBoundingBoxColor(index);
                    const label = `Object ${index + 1}`;
                    
                    // 라벨 배경 그리기
                    overlayContext.fillStyle = boxColor;
                    overlayContext.font = 'bold 14px Arial';
                    const textMetrics = overlayContext.measureText(label);
                    const textWidth = textMetrics.width + 8;
                    const textHeight = 20;
                    
                    overlayContext.fillRect(scaledX1, scaledY1 - textHeight, textWidth, textHeight);
                    
                    // 라벨 텍스트 그리기 (배경에 따라 적절한 색상 선택)
                    overlayContext.fillStyle = (index % 2 === 0) ? '#FFFFFF' : '#000000';
                    overlayContext.fillText(label, scaledX1 + 4, scaledY1 - 6);
                }
            });
        }
    }
    
    // 모델별 색상 결정
    function getModelColor(model) {
        const modelColors = {
            'block': '#FFD700',    // 골드 (블록 - Go_Forward, Stop)
            'scooter': '#FF1493',  // 딥핑크 (스쿠터)
            'button': '#00FF7F'    // 스프링그린 (음향 신호기)
        };
        return modelColors[model] || '#FFFFFF';
    }
    
    // 모델별 텍스트 색상 결정
    function getTextColor(model) {
        const textColors = {
            'block': '#000000',    // 검은색 (노란 배경에)
            'scooter': '#FFFFFF',  // 흰색 (딥핑크 배경에)
            'button': '#000000'    // 검은색 (스프링그린 배경에)
        };
        return textColors[model] || '#000000';
    }
    
    // 클래스 이름을 사용자 친화적으로 변환
    function getDisplayName(className) {
        const nameMap = {
            'Go_Forward': '직진',
            'Stop': '정지',
            'Scooter': '스쿠터',
            'Sound_Button': '음향신호기'
        };
        return nameMap[className] || className;
    }
    
    // 바운딩 박스 색상 결정 (백업용)
    function getBoundingBoxColor(index) {
        const colors = [
            '#FF1493', // 딥핑크 (스쿠터)
            '#00FF7F', // 스프링그린 (음향 신호기)
            '#FFD700', // 골드 (블록)
            '#FF8000', // 다크오렌지
            '#8A2BE2'  // 블루바이올렛
        ];
        return colors[index % colors.length];
    }
    
    // 네비게이션 화살표 그리기
    function drawNavigationArrows() {
        if (!currentArrows || !currentArrows.arrows) return;
        
        const scaleX = overlayCanvas.width / video.videoWidth;
        const scaleY = overlayCanvas.height / video.videoHeight;
        
        // 상태 텍스트 표시
        if (currentArrows.state_text) {
            const stateText = `State: ${currentArrows.state_text}`;
            overlayContext.font = 'bold 20px Arial';
            
            // 텍스트 배경 그리기 (가독성을 위해)
            const textMetrics = overlayContext.measureText(stateText);
            const textWidth = textMetrics.width + 16;
            const textHeight = 28;
            
            overlayContext.fillStyle = 'rgba(0, 0, 0, 0.7)'; // 반투명 검은 배경
            overlayContext.fillRect(16, 16, textWidth, textHeight);
            
            // 텍스트 외곽선
            overlayContext.strokeStyle = '#000000';
            overlayContext.lineWidth = 3;
            overlayContext.strokeText(stateText, 24, 36);
            
            // 텍스트 그리기
            overlayContext.fillStyle = '#FFFFFF';
            overlayContext.fillText(stateText, 24, 36);
        }
        
        // 화살표 그리기
        currentArrows.arrows.forEach(arrow => {
            if (arrow.start && arrow.end && arrow.start.length >= 2 && arrow.end.length >= 2) {
                // 좌표 스케일링
                const startX = arrow.start[0] * scaleX;
                const startY = arrow.start[1] * scaleY;
                const endX = arrow.end[0] * scaleX;
                const endY = arrow.end[1] * scaleY;
                
                // 화살표 색상 설정
                overlayContext.strokeStyle = arrow.color || '#FFFF00';
                overlayContext.fillStyle = arrow.color || '#FFFF00';
                overlayContext.lineWidth = 4;
                
                // 화살표 그리기
                drawArrow(startX, startY, endX, endY);
            }
        });
    }
    
    // 교차로 화살표 그리기
    function drawIntersectionArrows(centerX, centerY, arrowLength) {
        // 여러 방향으로 화살표 그리기 (예시)
        const directions = [
            { angle: -Math.PI/2, label: 'Forward' },  // 위쪽
            { angle: 0, label: 'Right' },             // 오른쪽
            { angle: Math.PI, label: 'Left' }         // 왼쪽
        ];
        
        directions.forEach(dir => {
            const endX = centerX + Math.cos(dir.angle) * arrowLength;
            const endY = centerY + Math.sin(dir.angle) * arrowLength;
            drawArrow(centerX, centerY, endX, endY);
        });
    }
    
    // 직진 화살표 그리기
    function drawStraightArrow(centerX, centerY, arrowLength) {
        const startY = centerY + arrowLength / 2;
        const endY = centerY - arrowLength / 2;
        drawArrow(centerX, startY, centerX, endY);
    }
    
    // 화살표 그리기 헬퍼 함수
    function drawArrow(fromX, fromY, toX, toY) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const arrowHeadLength = 15;
        
        // 화살표 선
        overlayContext.beginPath();
        overlayContext.moveTo(fromX, fromY);
        overlayContext.lineTo(toX, toY);
        overlayContext.stroke();
        
        // 화살표 머리
        overlayContext.beginPath();
        overlayContext.moveTo(toX, toY);
        overlayContext.lineTo(
            toX - arrowHeadLength * Math.cos(angle - Math.PI / 6),
            toY - arrowHeadLength * Math.sin(angle - Math.PI / 6)
        );
        overlayContext.moveTo(toX, toY);
        overlayContext.lineTo(
            toX - arrowHeadLength * Math.cos(angle + Math.PI / 6),
            toY - arrowHeadLength * Math.sin(angle + Math.PI / 6)
        );
        overlayContext.stroke();
    }
    
    // 연속 렌더링 시작
    function startRendering() {
        if (renderTimer) {
            clearInterval(renderTimer);
        }
        
        renderTimer = setInterval(() => {
            if (isStreaming && overlayCanvas) {
                renderOverlay();
            }
        }, 50); // 20 FPS로 오버레이 렌더링
    }
    
    // 연속 렌더링 중지
    function stopRendering() {
        if (renderTimer) {
            clearInterval(renderTimer);
            renderTimer = null;
        }
    }
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
    let before = ''
    // 안내 메시지 업데이트
    function updateInstruction(message, type) {
        instructionText.textContent = message;
        instructionBox.className = `instruction ${type}`;
        if (before != message) {speak(message)}
        before = message
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
                console.log('비디오 메타데이터 로드됨:', video.videoWidth, 'x', video.videoHeight);
                video.play().then(() => {
                    isStreaming = true;
                    startButton.textContent = '카메라 중지';
                    statusText.textContent = '카메라가 활성화되었습니다.';
                    statusText.style.color = 'green';
                    debugStatus.textContent = '스트리밍 중';
                    
                    // 비디오 재생 시작 후 약간의 지연을 두고 오버레이 생성
                    setTimeout(() => {
                        createOverlayCanvas();
                        startRendering();
                        startCapture();
                    }, 500);
                }).catch(err => {
                    console.error('비디오 재생 오류:', err);
                });
            };
            
            // 비디오 크기 변경 및 로드 이벤트 추가
            video.addEventListener('loadeddata', () => {
                console.log('비디오 데이터 로드됨');
                setTimeout(resizeOverlayCanvas, 100);
            });
            video.addEventListener('resize', resizeOverlayCanvas);
            window.addEventListener('resize', resizeOverlayCanvas);
            
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
        
        // 렌더링 중지 및 오버레이 제거
        stopRendering();
        if (overlayCanvas) {
            overlayCanvas.remove();
            overlayCanvas = null;
            overlayContext = null;
        }
        
        // 데이터 초기화
        currentBoxes = [];
        currentBoxData = [];
        currentNavigation = null;
        currentArrows = null;
        
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
    
    // 화면 방향 변경 시 캔버스 크기 조정
    window.addEventListener('orientationchange', () => {
        setTimeout(resizeOverlayCanvas, 100);
    });
});
