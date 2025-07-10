from flask import Flask, render_template,request, redirect, url_for, Response
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

#개발용 시크릿 키
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
    print("Test")
    print(f"흑백 모드 변경됨: {grayscale_mode}")
    return {'status': 'success', 'grayscale_mode': grayscale_mode}

@socketio.on('start-camera')
def handle_start_camera():
    print('test')

@socketio.on('connect')
def handle_connect():
    global grayscale_mode
    print('Client connected')
    # 클라이언트 연결 시 현재 흑백 모드 상태를 전송
    emit('grayscale_mode_sync', {'grayscale_mode': grayscale_mode})

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
    if grayscale_mode:
        print("흑백 모드로 이미지 처리 중...")
        img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img = cv2.cvtColor(img_gray, cv2.COLOR_GRAY2BGR)
    
    # 다중 모델로 객체 감지
    all_box_coords, detected_classes, detected_boxes, navigation_info, arrow_info = navigation_model.detect(img)
    
    # 디버깅 정보 출력
    print("\n=== 감지 결과 ===")
    print(f"감지된 클래스: {detected_classes}")
    print(f"감지된 박스 수: {len(detected_boxes)}")
    print(f"네비게이션 정보: {navigation_info}")
    print(f"모든 바운딩 박스 좌표: {all_box_coords}")
    print(f"화살표 정보: {arrow_info}")
    
    # 결과 이미지를 생성하지 않으므로 관련 코드 주석 처리 또는 삭제
    # # 흑백 모드인 경우, 결과 이미지도 그레이스케일로 변환
    # if grayscale_mode:
    #     result_gray = cv2.cvtColor(result_img, cv2.COLOR_BGR2GRAY)
    #     result_img = cv2.cvtColor(result_gray, cv2.COLOR_GRAY2BGR)
    
    # # 압축 품질 최대화
    # encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 100]
    # _, buffer = cv2.imencode('.jpg', result_img, encode_param)
    # result_data = base64.b64encode(buffer).decode('utf-8')
    
    # 처리 시간 측정
    process_time = time.time() - start_time
    print(f"Frame processed in {process_time:.3f} seconds.")
    
    # 응답 데이터 준비
    response_data = {
        'image': '', # 이미지를 보내지 않음
        'classes': detected_classes,
        'boxes': detected_boxes,
        'box_coords': all_box_coords, # 바운딩 박스 좌표 추가
        'navigation': navigation_info,
        'arrows': arrow_info, # 화살표 정보 추가
        'grayscale_mode': grayscale_mode
    }
    
    emit('result', response_data)


@app.route('/upload', methods=['GET', 'POST'])
def upload_image():
    if request.method == 'POST':
        if 'image' not in request.files:
            return 'No file part'
        
        file = request.files['image']
        if file.filename == '':
            return 'No selected file'
        
        # 파일 -> 이미지 배열로 변환
        file_bytes = np.frombuffer(file.read(), np.uint8)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)

        if img is None:
            return 'Invalid image'

        # 흑백 모드 적용
        if grayscale_mode:
            print("흑백 모드로 이미지 처리 중...")
            img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            img = cv2.cvtColor(img_gray, cv2.COLOR_GRAY2BGR)

        # 모델 처리
        all_box_coords, detected_classes, detected_boxes, navigation_info, arrow_info = navigation_model.detect(img)

        # if grayscale_mode:
        #     result_gray = cv2.cvtColor(result_img, cv2.COLOR_BGR2GRAY)
        #     result_img = cv2.cvtColor(result_gray, cv2.COLOR_GRAY2BGR)

        # # 이미지 -> base64 인코딩
        # encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 100]
        # _, buffer = cv2.imencode('.jpg', result_img, encode_param)
        # result_data = base64.b64encode(buffer).decode('utf-8')

        return render_template('result.html',
                               image='', # 이미지를 보내지 않음
                               classes=detected_classes,
                               boxes=detected_boxes,
                               box_coords=all_box_coords, # 바운딩 박스 좌표 추가
                               navigation=navigation_info,
                               arrows=arrow_info) # 화살표 정보 추가

    return render_template('upload.html')

if __name__ == '__main__':
    # SSL 인증서 경로
    cert_path = 'cert/cert.pem'
    key_path = 'cert/key.pem'
    
    # 인증서가 없는 경우 생성
    if not (os.path.exists(cert_path) and os.path.exists(key_path)):
        from generate_cert import generate_certificate
        generate_certificate()
    
    # HTTPS로 서버 실행
    print("시각장애인 도로 안내 camera일 서버를 시작합니다...")
    print("이 서버에 모바일 기기로 접속하려면 다음 URL을 사용하세요:")
    print("https://<맥북IP주e소>:5001")
    
    socketio.run(app, host='0.0.0.0', port=5001, 
                 ssl_context=(cert_path, key_path), 
                 debug=False)