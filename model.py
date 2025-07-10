import cv2
import numpy as np
import torch
import os
from ultralytics import YOLO

class BlindNavigationModel:
    def __init__(self):
        """시각장애인 도로 안내를 위한 다중 YOLO 모델 초기화"""
        print("다중 YOLO 모델 로딩 중...")
        
        # 모델 경로 설정
        self.model_paths = {
            'block': './block.pt',
            'scooter': './scooter.pt', 
            'button': './button.pt'
        }
        
        # 모델 로드
        self.models = {}
        for model_name, model_path in self.model_paths.items():
            try:
                if os.path.exists(model_path):
                    self.models[model_name] = YOLO(model_path)
                    print(f"✓ {model_name} 모델 로드 완료: {model_path}")
                else:
                    print(f"⚠️ {model_name} 모델 파일을 찾을 수 없습니다: {model_path}")
                    self.models[model_name] = None
            except Exception as e:
                print(f"❌ {model_name} 모델 로드 실패: {e}")
                self.models[model_name] = None
        
        # 신뢰도 임계값
        self.conf_threshold = 0.7
        
        print("모델 초기화 완료!")
    
    def detect(self, image):
        """이미지에서 다중 모델로 객체 감지"""
        detected_classes = []
        detected_boxes = []
        
        # 각 모델별 결과 저장
        model_results = {}
        
        # 1. 블록 모델 (경로 분석)
        if self.models['block']:
            try:
                results_block = self.models['block'](image, verbose=False, conf=self.conf_threshold)
                model_results['block'] = results_block[0]
                block_classes, block_boxes = self._process_block_results(results_block[0])
                detected_classes.extend(block_classes)
                detected_boxes.extend(block_boxes)
            except Exception as e:
                print(f"블록 모델 처리 오류: {e}")
                model_results['block'] = None
        
        # 2. 스쿠터 모델 (장애물 감지)
        if self.models['scooter']:
            try:
                results_scooter = self.models['scooter'](image, verbose=False, conf=self.conf_threshold)
                model_results['scooter'] = results_scooter[0]
                scooter_classes, scooter_boxes = self._process_scooter_results(results_scooter[0])
                detected_classes.extend(scooter_classes)
                detected_boxes.extend(scooter_boxes)
            except Exception as e:
                print(f"스쿠터 모델 처리 오류: {e}")
                model_results['scooter'] = None

        # 3. 음향 신호기 모델
        if self.models['button']:
            try:
                results_button = self.models['button'](image, verbose=False, conf=self.conf_threshold)
                model_results['button'] = results_button[0]
                button_classes, button_boxes = self._process_button_results(results_button[0])
                detected_classes.extend(button_classes)
                detected_boxes.extend(button_boxes)
            except Exception as e:
                print(f"음향 신호기 모델 처리 오류: {e}")
                model_results['button'] = None
        
        # 네비게이션 정보 생성
        navigation_info = self._generate_navigation_info(model_results, detected_classes, detected_boxes)
        
        # 화살표 정보 생성
        arrow_info = self._generate_arrow_info(image, model_results)
        
        all_box_coords = [item['box'] for item in detected_boxes]
        
        return all_box_coords, detected_classes, detected_boxes, navigation_info, arrow_info
    
    def _process_block_results(self, results):
        """블록 모델 결과 처리"""
        classes = []
        boxes = []
        
        if results and results.boxes is not None:
            for box_data in results.boxes:
                cls_id = int(box_data.cls[0])
                confidence = float(box_data.conf[0])
                box_coords = box_data.xyxy[0].cpu().numpy().astype(int)
                
                if confidence >= self.conf_threshold:
                    # 클래스 ID에 따른 분류
                    if cls_id == 0:  # Go_Forward
                        class_name = 'Go_Forward'
                    elif cls_id == 1:  # Stop
                        class_name = 'Stop'
                    else:
                        class_name = f'Block_Class_{cls_id}'
                    
                    classes.append(class_name)
                    boxes.append({
                        'class': class_name,
                        'confidence': confidence,
                        'box': box_coords.tolist(),
                        'model': 'block'
                    })
        
        return classes, boxes
    
    def _process_scooter_results(self, results):
        """스쿠터 모델 결과 처리"""
        classes = []
        boxes = []
        
        if results and results.boxes is not None:
            for box_data in results.boxes:
                confidence = float(box_data.conf[0])
                box_coords = box_data.xyxy[0].cpu().numpy().astype(int)
                
                if confidence >= 0.5: #스쿠터 모델만 임계값 낮게(인식 잘 안됨)
                    classes.append('Scooter')
                    boxes.append({
                        'class': 'Scooter',
                        'confidence': confidence,
                        'box': box_coords.tolist(),
                        'model': 'scooter'
                    })
        
        return classes, boxes
    
    def _process_button_results(self, results):
        """음향 신호기 모델 결과 처리"""
        classes = []
        boxes = []
        
        if results and results.boxes is not None:
            for box_data in results.boxes:
                confidence = float(box_data.conf[0])
                box_coords = box_data.xyxy[0].cpu().numpy().astype(int)
                
                if confidence >= self.conf_threshold:
                    classes.append('Sound_Button')
                    boxes.append({
                        'class': 'Sound_Button',
                        'confidence': confidence,
                        'box': box_coords.tolist(),
                        'model': 'button'
                    })
        
        return classes, boxes
    
    def _draw_results(self, image, model_results):
        """결과 이미지에 바운딩 박스와 화살표 그리기"""
        result_img = image.copy()
        h, w, _ = image.shape
        arrow_length = int(np.sqrt(h**2 + w**2) * 0.15)
        arrow_thickness = max(2, int(w / 120))
        
        # 블록 모델 결과로 경로 화살표 그리기
        if model_results.get('block'):
            result_img = self._draw_navigation_arrows(result_img, model_results['block'], arrow_length, arrow_thickness)
        
        # 각 모델별 바운딩 박스 그리기
        colors = {
            'scooter': (255, 0, 255),  # 마젠타 (스쿠터)
            'button': (0, 255, 200)    # 연두색 (음향 신호기)
        }
        
        for model_name, color in colors.items():
            if model_results.get(model_name) and model_results[model_name].boxes is not None:
                for box_data in model_results[model_name].boxes:
                    confidence = float(box_data.conf[0])
                    if confidence >= self.conf_threshold:
                        x1, y1, x2, y2 = box_data.xyxy[0].cpu().numpy().astype(int)
                        cv2.rectangle(result_img, (x1, y1), (x2, y2), color, arrow_thickness)
                        
                        # 라벨 텍스트
                        label_map = {
                            'scooter': 'Scooter',
                            'button': 'Sound Button'
                        }
                        label = f"{label_map[model_name]}: {confidence:.2f}"
                        cv2.putText(result_img, label, (x1, y1 - 10), 
                                  cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        
        return result_img
    
    def _draw_navigation_arrows(self, image, block_results, arrow_length, arrow_thickness):
        """블록 모델 결과를 기반으로 네비게이션 화살표 그리기"""
        if not block_results.boxes:
            return image
        
        # 기존 main.py의 경로 분석 로직 적용
        initial_stop_boxes, go_boxes = [], []
        
        for box_data in block_results.boxes:
            cls_id = int(box_data.cls[0])
            confidence = float(box_data.conf[0])
            box = box_data.xyxy[0].cpu().numpy().astype(int)
            
            if confidence >= self.conf_threshold:
                if cls_id == 1:  # Stop
                    initial_stop_boxes.append(box)
                else:  # Go_Forward
                    go_boxes.append(box)
        
        # 겹치는 박스 병합
        stop_boxes = self._merge_close_boxes(initial_stop_boxes)
        
        # 경로 분석 및 화살표 그리기
        if stop_boxes and go_boxes:
            # 교차로 상황
            for stop_box in stop_boxes:
                stop_center = self._get_box_center(stop_box)
                proximity_threshold = (stop_box[2] - stop_box[0]) * 3.0
                
                candidate_vectors = []
                for go_box in go_boxes:
                    go_center = self._get_box_center(go_box)
                    vec = go_center - stop_center
                    if 0 < np.linalg.norm(vec) < proximity_threshold:
                        candidate_vectors.append(vec)
                
                if candidate_vectors:
                    # 방향 클러스터링 및 화살표 그리기
                    clustered_directions = self._cluster_directions(candidate_vectors)
                    for vec in clustered_directions:
                        norm_vec = vec / (np.linalg.norm(vec) + 1e-6)
                        endpoint = stop_center + (norm_vec * arrow_length)
                        cv2.arrowedLine(image, tuple(stop_center.astype(int)), 
                                      tuple(endpoint.astype(int)), (255, 255, 0), arrow_thickness, tipLength=0.25)
            
            cv2.putText(image, "State: Intersection", (20, 40), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
        
        elif go_boxes:
            # 직진 상황
            all_path_points = []
            for box in go_boxes:
                x1, y1, x2, y2 = box
                step = (y2 - y1) // 4
                if step > 0:
                    for i in range(4):
                        all_path_points.append(np.array([(x1+x2)//2, y1+i*step+step//2]))
                else:
                    all_path_points.append(self._get_box_center(box))
            
            if len(all_path_points) >= 2:
                all_path_points.sort(key=lambda pt: pt[1], reverse=True)
                for i in range(len(all_path_points) - 1):
                    pt1, pt2 = all_path_points[i], all_path_points[i+1]
                    if pt1[1] > pt2[1]:
                        cv2.arrowedLine(image, tuple(pt1.astype(int)), 
                                      tuple(pt2.astype(int)), (255, 0, 0), 
                                      max(1, arrow_thickness - 1), tipLength=0.3)
            
            cv2.putText(image, "State: Straight", (20, 40), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
        
        return image
    
    def _merge_close_boxes(self, boxes, iou_threshold=0.7):
        """겹치는 박스들을 병합"""
        if not boxes:
            return []
        
        boxes = sorted(boxes, key=lambda b: (b[2]-b[0])*(b[3]-b[1]), reverse=True)
        merged = []
        remaining = list(boxes)
        
        while remaining:
            base = remaining.pop(0)
            temp = []
            
            for other in remaining:
                # IoU 계산
                xA = max(base[0], other[0])
                yA = max(base[1], other[1])
                xB = min(base[2], other[2])
                yB = min(base[3], other[3])
                
                inter_area = max(0, xB - xA) * max(0, yB - yA)
                
                if inter_area > 0:
                    base_area = (base[2]-base[0])*(base[3]-base[1])
                    other_area = (other[2]-other[0])*(other[3]-other[1])
                    iou = inter_area / float(base_area + other_area - inter_area)
                    
                    if iou < iou_threshold:
                        temp.append(other)
                else:
                    temp.append(other)
            
            merged.append(base)
            remaining = temp
        
        return merged
    
    def _get_box_center(self, box):
        """박스의 중심점 계산"""
        return np.array([(box[0] + box[2]) // 2, (box[1] + box[3]) // 2])
    
    def _cluster_directions(self, vectors, angle_threshold=45):
        """방향 벡터들을 클러스터링"""
        if not vectors:
            return []
        
        unique_groups = []
        for vec in vectors:
            is_new_group = True
            for group in unique_groups:
                angle = self._get_angle_between(vec, group[0])
                if angle < angle_threshold:
                    group.append(vec)
                    is_new_group = False
                    break
            
            if is_new_group:
                unique_groups.append([vec])
        
        # 각 그룹의 평균 방향 계산
        clustered_directions = []
        for group in unique_groups:
            if group:
                avg_direction = np.mean(group, axis=0)
                clustered_directions.append(avg_direction)
        
        return clustered_directions
    
    def _get_angle_between(self, v1, v2):
        """두 벡터 사이의 각도 계산"""
        norm_v1 = np.linalg.norm(v1)
        norm_v2 = np.linalg.norm(v2)
        if norm_v1 == 0 or norm_v2 == 0:
            return 180.0
        
        dot_product = np.dot(v1, v2)
        cos_angle = dot_product / (norm_v1 * norm_v2)
        return np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0)))
    
    def _generate_arrow_info(self, image, model_results):
        """화살표 정보 생성 - 클라이언트에서 렌더링하기 위한 데이터"""
        arrow_info = {
            'arrows': [],
            'state_text': '',
            'state_color': '#FFFF00'
        }
        
        if not model_results.get('block') or not model_results['block'].boxes:
            return arrow_info
        
        h, w, _ = image.shape
        arrow_length = int(np.sqrt(h**2 + w**2) * 0.15)
        
        # 블록 모델 결과 분석
        initial_stop_boxes, go_boxes = [], []
        
        for box_data in model_results['block'].boxes:
            cls_id = int(box_data.cls[0])
            confidence = float(box_data.conf[0])
            box = box_data.xyxy[0].cpu().numpy().astype(int)
            
            if confidence >= self.conf_threshold:
                if cls_id == 1:  # Stop
                    initial_stop_boxes.append(box)
                else:  # Go_Forward
                    go_boxes.append(box)
        
        # 겹치는 박스 병합
        stop_boxes = self._merge_close_boxes(initial_stop_boxes)
        
        # 경로 분석 및 화살표 정보 생성
        if stop_boxes and go_boxes:
            # 교차로 상황
            arrow_info['state_text'] = 'Intersection'
            arrow_info['state_color'] = '#00FF00'
            
            for stop_box in stop_boxes:
                stop_center = self._get_box_center(stop_box)
                proximity_threshold = (stop_box[2] - stop_box[0]) * 3.0
                
                candidate_vectors = []
                for go_box in go_boxes:
                    go_center = self._get_box_center(go_box)
                    vec = go_center - stop_center
                    if 0 < np.linalg.norm(vec) < proximity_threshold:
                        candidate_vectors.append(vec)
                
                if candidate_vectors:
                    # 방향 클러스터링 및 화살표 정보 생성
                    clustered_directions = self._cluster_directions(candidate_vectors)
                    for vec in clustered_directions:
                        norm_vec = vec / (np.linalg.norm(vec) + 1e-6)
                        endpoint = stop_center + (norm_vec * arrow_length)
                        
                        arrow_info['arrows'].append({
                            'type': 'intersection',
                            'start': [int(stop_center[0]), int(stop_center[1])],
                            'end': [int(endpoint[0]), int(endpoint[1])],
                            'color': '#FFFF00'
                        })
        
        elif go_boxes:
            # 직진 상황
            arrow_info['state_text'] = 'Straight'
            arrow_info['state_color'] = '#00FFFF'
            
            all_path_points = []
            for box in go_boxes:
                x1, y1, x2, y2 = box
                step = (y2 - y1) // 4
                if step > 0:
                    for i in range(4):
                        all_path_points.append(np.array([(x1+x2)//2, y1+i*step+step//2]))
                else:
                    all_path_points.append(self._get_box_center(box))
            
            if len(all_path_points) >= 2:
                all_path_points.sort(key=lambda pt: pt[1], reverse=True)
                for i in range(len(all_path_points) - 1):
                    pt1, pt2 = all_path_points[i], all_path_points[i+1]
                    if pt1[1] > pt2[1]:
                        arrow_info['arrows'].append({
                            'type': 'straight',
                            'start': [int(pt1[0]), int(pt1[1])],
                            'end': [int(pt2[0]), int(pt2[1])],
                            'color': '#FF0000'
                        })
        
        return arrow_info

    def _generate_navigation_info(self, model_results, detected_classes, detected_boxes):
        """네비게이션 정보 생성"""
        navigation_info = {
            'state': 'unknown',
            'direction': 'none',
            'warnings': [],
            'signals': {
                'sound_button': False
            },
            'obstacles': []
        }
        
        # 상태 결정
        if 'Stop' in detected_classes:
            navigation_info['state'] = 'intersection'
            navigation_info['direction'] = 'stop'
        elif 'Go_Forward' in detected_classes:
            navigation_info['state'] = 'straight'
            navigation_info['direction'] = 'forward'
        else:
            navigation_info['state'] = 'unknown'
            navigation_info['direction'] = 'none'
        
        # 경고 사항
        if 'Scooter' in detected_classes:
            navigation_info['warnings'].append('장애물이 감지되었습니다')
            navigation_info['obstacles'].append('scooter')
        
        # 신호 정보
        if 'Sound_Button' in detected_classes:
            navigation_info['signals']['sound_button'] = True
        
        # 복합 상황 처리
        if navigation_info['obstacles'] and navigation_info['direction'] == 'forward':
            navigation_info['warnings'].append('전방에 장애물이 있으니 주의하세요')
        
        return navigation_info
