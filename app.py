from flask import Flask, render_template, Response
from flask_socketio import SocketIO, emit
import cv2
import numpy as np
import base64
import ssl
import os
import time
import json
from model import BlindNavigationModel

app = Flask(__name__)
app.config['SECRET_KEY'] = 'blind-road-helper-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# 시각장애인 도로 안내 모델 로드
navigation_model = BlindNavigationModel()

# 흑백 모드 상태 변수
grayscale_mode = False

@app.route('/')
def index():
    return render_template('index.html')

# 흑백 모드 토글 이벤트 핸들러
@socketio.on('toggle_grayscale')
def handle_toggle_grayscale(data):
    global grayscale_mode
    grayscale_mode = data
    print(f"흑백 모드 변경됨: {grayscale_mode}")
    return {'status': 'success', 'grayscale_mode': grayscale_mode}

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('image')
def handle_image(data):
    global grayscale_mode
    start_time = time.time()
    
    # base64 이미지 데이터 받기
    image_data = data.split(',')[1]
    image_bytes = base64.b64decode(image_data)
    
    # 이미지로 변환
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None or img.size == 0:
        print("Error: Invalid image data received")
        return
    
    # 흑백 모드가 활성화된 경우 이미지를 그레이스케일로 변환
    original_img = img.copy()
    if grayscale_mode:
        print("흑백 모드로 이미지 처리 중...")
        img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img = cv2.cvtColor(img_gray, cv2.COLOR_GRAY2BGR)
    
    # 다중 모델로 객체 감지
    result_img, detected_classes, detected_boxes, navigation_info = navigation_model.detect(img)
    
    # 디버깅 정보 출력
    print("\n=== 감지 결과 ===")
    print(f"감지된 클래스: {detected_classes}")
    print(f"감지된 박스 수: {len(detected_boxes)}")
    print(f"네비게이션 정보: {navigation_info}")
    
    # 흑백 모드인 경우, 결과 이미지도 그레이스케일로 변환
    if grayscale_mode:
        result_gray = cv2.cvtColor(result_img, cv2.COLOR_BGR2GRAY)
        result_img = cv2.cvtColor(result_gray, cv2.COLOR_GRAY2BGR)
    
    # 압축 품질 최대화
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 100]
    _, buffer = cv2.imencode('.jpg', result_img, encode_param)
    result_data = base64.b64encode(buffer).decode('utf-8')
    
    # 처리 시간 측정
    process_time = time.time() - start_time
    print(f"Frame processed in {process_time:.3f} seconds.")
    
    # 응답 데이터 준비
    response_data = {
        'image': f'data:image/jpeg;base64,{result_data}',
        'classes': detected_classes,
        'boxes': detected_boxes,
        'navigation': navigation_info,
        'grayscale_mode': grayscale_mode
    }
    
    emit('result', response_data)

if __name__ == '__main__':
    # SSL 인증서 경로
    cert_path = 'cert/cert.pem'
    key_path = 'cert/key.pem'
    
    # 인증서가 없는 경우 생성
    if not (os.path.exists(cert_path) and os.path.exists(key_path)):
        from generate_cert import generate_certificate
        generate_certificate()
    
    # HTTPS로 서버 실행
    print("시각장애인 도로 안내 모바일 서버를 시작합니다...")
    print("이 서버에 모바일 기기로 접속하려면 다음 URL을 사용하세요:")
    print("https://<맥북IP주소>:5001")
    
    socketio.run(app, host='0.0.0.0', port=5001, 
                 ssl_context=(cert_path, key_path), 
                 debug=False)
