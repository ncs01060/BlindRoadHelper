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
    let currentNavigation = null;
    let currentBlockDetails = null; // 블록 모델 상세 정보 저장
    let renderTimer = null;
    
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
                currentBoxes = data.boxes.map(box => box.box); // 좌표만 추출
            }
            
            // 네비게이션 정보 저장 및 업데이트
            if (data.navigation) {
                currentNavigation = data.navigation;
            }
            
            // 블록 모델 상세 정보 저장 (화살표용)
            if (data.block_details) {
                currentBlockDetails = data.block_details;
                console.log('블록 상세 정보:', currentBlockDetails);
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
        
        video.parentNode.style.position = 'relative';
        video.parentNode.appendChild(overlayCanvas);
        
        overlayContext = overlayCanvas.getContext('2d');
        
        // 캔버스 크기를 비디오에 맞춤
        resizeOverlayCanvas();
    }
    
    // 오버레이 캔버스 크기 조정
    function resizeOverlayCanvas() {
        if (!overlayCanvas || !video) return;
        
        const rect = video.getBoundingClientRect();
        overlayCanvas.width = video.videoWidth || rect.width;
        overlayCanvas.height = video.videoHeight || rect.height;
        overlayCanvas.style.width = rect.width + 'px';
        overlayCanvas.style.height = rect.height + 'px';
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
        if (currentBlockDetails) {
            drawNavigationArrows();
        }
    }
    
    // 바운딩 박스 그리기
    function drawBoundingBoxes() {
        const scaleX = overlayCanvas.width / video.videoWidth;
        const scaleY = overlayCanvas.height / video.videoHeight;
        
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
                
                // 라벨 표시 (옵션)
                overlayContext.fillStyle = overlayContext.strokeStyle;
                overlayContext.font = '16px Arial';
                overlayContext.fillText(`Object ${index + 1}`, scaledX1, scaledY1 - 5);
            }
        });
    }
    
    // 바운딩 박스 색상 결정
    function getBoundingBoxColor(index) {
        const colors = [
            '#FF0080', // 마젠타 (스쿠터)
            '#00C8FF', // 오렌지 (신호등)
            '#00FFC8', // 연두색 (음향 신호기)
            '#FFFF00', // 노란색 (블록)
            '#FF8000', // 주황색
            '#8000FF'  // 보라색
        ];
        return colors[index % colors.length];
    }
    
    // 네비게이션 화살표 그리기 (기존 model.py 로직 완전 재현)
    function drawNavigationArrows() {
        if (!currentBlockDetails || !overlayContext) return;
        
        const scaleX = overlayCanvas.width / video.videoWidth;
        const scaleY = overlayCanvas.height / video.videoHeight;
        const arrowLength = Math.min(overlayCanvas.width, overlayCanvas.height) * 0.15;
        const arrowThickness = Math.max(2, overlayCanvas.width / 120);
        
        const stopBoxes = currentBlockDetails.merged_stop_boxes || [];
        const goBoxes = currentBlockDetails.go_boxes || [];
        
        console.log('화살표 그리기:', { stopBoxes, goBoxes, arrowLength, arrowThickness });
        
        if (stopBoxes.length > 0 && goBoxes.length > 0) {
            // 교차로 상황
            drawIntersectionArrows(stopBoxes, goBoxes, arrowLength, arrowThickness, scaleX, scaleY);
            
            // 상태 텍스트 표시
            overlayContext.fillStyle = '#00FF00';
            overlayContext.font = 'bold 20px Arial';
            overlayContext.fillText('State: Intersection', 20, 40);
            
        } else if (goBoxes.length > 0) {
            // 직진 상황
            drawStraightArrows(goBoxes, arrowLength, arrowThickness, scaleX, scaleY);
            
            // 상태 텍스트 표시
            overlayContext.fillStyle = '#00FFFF';
            overlayContext.font = 'bold 20px Arial';
            overlayContext.fillText('State: Straight', 20, 40);
        }
    }
    
    // 교차로 화살표 그리기 (기존 로직 재현)
    function drawIntersectionArrows(stopBoxes, goBoxes, arrowLength, arrowThickness, scaleX, scaleY) {
        overlayContext.strokeStyle = '#FFFF00'; // 노란색 화살표
        overlayContext.lineWidth = arrowThickness;
        
        stopBoxes.forEach(stopBox => {
            const stopCenter = getBoxCenter(stopBox);
            const scaledStopCenter = [stopCenter[0] * scaleX, stopCenter[1] * scaleY];
            const proximityThreshold = (stopBox[2] - stopBox[0]) * 3.0;
            
            const candidateVectors = [];
            
            goBoxes.forEach(goBox => {
                const goCenter = getBoxCenter(goBox);
                const vec = [goCenter[0] - stopCenter[0], goCenter[1] - stopCenter[1]];
                const vecLength = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1]);
                
                if (vecLength > 0 && vecLength < proximityThreshold) {
                    candidateVectors.push(vec);
                }
            });
            
            if (candidateVectors.length > 0) {
                const clusteredDirections = clusterDirections(candidateVectors);
                
                clusteredDirections.forEach(vec => {
                    const vecLength = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1]);
                    if (vecLength > 0) {
                        const normVec = [vec[0] / vecLength, vec[1] / vecLength];
                        const scaledArrowLength = arrowLength;
                        const endpoint = [
                            scaledStopCenter[0] + normVec[0] * scaledArrowLength,
                            scaledStopCenter[1] + normVec[1] * scaledArrowLength
                        ];
                        
                        drawArrowedLine(scaledStopCenter, endpoint, arrowThickness);
                    }
                });
            }
        });
    }
    
    // 직진 화살표 그리기 (기존 로직 재현)
    function drawStraightArrows(goBoxes, arrowLength, arrowThickness, scaleX, scaleY) {
        overlayContext.strokeStyle = '#FF0000'; // 빨간색 화살표
        overlayContext.lineWidth = Math.max(1, arrowThickness - 1);
        
        const allPathPoints = [];
        
        goBoxes.forEach(box => {
            const [x1, y1, x2, y2] = box;
            const step = Math.floor((y2 - y1) / 4);
            
            if (step > 0) {
                for (let i = 0; i < 4; i++) {
                    allPathPoints.push([
                        Math.floor((x1 + x2) / 2),
                        y1 + i * step + Math.floor(step / 2)
                    ]);
                }
            } else {
                allPathPoints.push(getBoxCenter(box));
            }
        });
        
        if (allPathPoints.length >= 2) {
            // Y 좌표 기준으로 정렬 (큰 값부터 - 아래에서 위로)
            allPathPoints.sort((a, b) => b[1] - a[1]);
            
            for (let i = 0; i < allPathPoints.length - 1; i++) {
                const pt1 = allPathPoints[i];
                const pt2 = allPathPoints[i + 1];
                
                if (pt1[1] > pt2[1]) { // 아래에서 위로 가는 화살표만
                    const scaledPt1 = [pt1[0] * scaleX, pt1[1] * scaleY];
                    const scaledPt2 = [pt2[0] * scaleX, pt2[1] * scaleY];
                    
                    drawArrowedLine(scaledPt1, scaledPt2, Math.max(1, arrowThickness - 1));
                }
            }
        }
    }
    
    // 박스의 중심점 계산
    function getBoxCenter(box) {
        return [Math.floor((box[0] + box[2]) / 2), Math.floor((box[1] + box[3]) / 2)];
    }
    
    // 방향 벡터 클러스터링
    function clusterDirections(vectors, angleThreshold = 45) {
        if (vectors.length === 0) return [];
        
        const uniqueGroups = [];
        
        vectors.forEach(vec => {
            let isNewGroup = true;
            
            for (let group of uniqueGroups) {
                const angle = getAngleBetween(vec, group[0]);
                if (angle < angleThreshold) {
                    group.push(vec);
                    isNewGroup = false;
                    break;
                }
            }
            
            if (isNewGroup) {
                uniqueGroups.push([vec]);
            }
        });
        
        // 각 그룹의 평균 방향 계산
        const clusteredDirections = [];
        uniqueGroups.forEach(group => {
            if (group.length > 0) {
                const avgX = group.reduce((sum, vec) => sum + vec[0], 0) / group.length;
                const avgY = group.reduce((sum, vec) => sum + vec[1], 0) / group.length;
                clusteredDirections.push([avgX, avgY]);
            }
        });
        
        return clusteredDirections;
    }
    
    // 두 벡터 사이의 각도 계산
    function getAngleBetween(v1, v2) {
        const norm1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
        const norm2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
        
        if (norm1 === 0 || norm2 === 0) return 180.0;
        
        const dotProduct = v1[0] * v2[0] + v1[1] * v2[1];
        const cosAngle = dotProduct / (norm1 * norm2);
        return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
    }
    
    // 화살표 그리기 (OpenCV arrowedLine 재현)
    function drawArrowedLine(fromPoint, toPoint, thickness, tipLength = 0.25) {
        const [fromX, fromY] = fromPoint;
        const [toX, toY] = toPoint;
        
        // 화살표 본체 그리기
        overlayContext.beginPath();
        overlayContext.moveTo(fromX, fromY);
        overlayContext.lineTo(toX, toY);
        overlayContext.stroke();
        
        // 화살표 머리 그리기
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const arrowHeadLength = Math.min(30, Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2) * tipLength);
        
        const arrowAngle1 = angle - Math.PI / 6;
        const arrowAngle2 = angle + Math.PI / 6;
        
        const arrowX1 = toX - arrowHeadLength * Math.cos(arrowAngle1);
        const arrowY1 = toY - arrowHeadLength * Math.sin(arrowAngle1);
        const arrowX2 = toX - arrowHeadLength * Math.cos(arrowAngle2);
        const arrowY2 = toY - arrowHeadLength * Math.sin(arrowAngle2);
        
        overlayContext.beginPath();
        overlayContext.moveTo(toX, toY);
        overlayContext.lineTo(arrowX1, arrowY1);
        overlayContext.moveTo(toX, toY);
        overlayContext.lineTo(arrowX2, arrowY2);
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
                
                // 오버레이 캔버스 생성 및 렌더링 시작
                createOverlayCanvas();
                startRendering();
                
                // 프레임 캡처 시작
                startCapture();
            };
            
            // 비디오 크기 변경 시 캔버스 크기도 조정
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
        currentNavigation = null;
        currentBlockDetails = null;
        
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
