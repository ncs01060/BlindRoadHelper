from ultralytics import YOLO
import cv2
import numpy as np
import os

# --- 1. 경로 설정 및 다중 모델 로딩 ---
model_path_block = "./block.pt"
model_path_scooter = "./scooter.pt"
model_path_sinho = "./sinho.pt"
model_path_button = "./button.pt"
image_path = "/Users/leeyoungmin/Desktop/ss/img/art_17306089943438_dbdbda.jpg"
output_path = "output/braille_navigation_result_multi_model.jpg"

print("모델을 로드합니다...")
model_block = YOLO(model_path_block)
model_scooter = YOLO(model_path_scooter)
model_sinho = YOLO(model_path_sinho)
model_button = YOLO(model_path_button)

image = cv2.imread(image_path)
if image is None:
    raise IOError(f"이미지를 로드하는 데 실패했습니다: {image_path}")
output = image.copy()

h, w, _ = image.shape
arrow_length = int(np.sqrt(h**2 + w**2) * 0.15)
arrow_thickness = max(2, int(w / 120))

# --- 2. 개별 모델 추론 수행 ---
print("각 모델에 대해 객체 탐지를 수행합니다...")
results_block = model_block(image_path)[0]
results_scooter = model_scooter(image_path)[0]
results_sinho = model_sinho(image_path)[0]  # 🔺 신호등 모델 추가
results_button = model_button(image_path)[0]  # 🔺 음향 신호기 모델 추가

# --- 3. 보조 함수 ---
def merge_close_boxes(boxes, iou_threshold=0.7):
    if not boxes: return []
    boxes = sorted(boxes, key=lambda b: (b[2]-b[0])*(b[3]-b[1]), reverse=True)
    merged, remaining = [], list(boxes)
    while remaining:
        base = remaining.pop(0)
        temp = []
        for other in remaining:
            xA = max(base[0], other[0]); yA = max(base[1], other[1])
            xB = min(base[2], other[2]); yB = min(base[3], other[3])
            inter_area = max(0, xB - xA) * max(0, yB - yA)
            if inter_area > 0:
                base_area = (base[2]-base[0])*(base[3]-base[1]); other_area = (other[2]-other[0])*(other[3]-other[1])
                iou = inter_area / float(base_area + other_area - inter_area)
                if iou < iou_threshold: temp.append(other)
            else: temp.append(other)
        merged.append(base); remaining = temp
    return merged

def get_box_center(box):
    return np.array([(box[0] + box[2]) // 2, (box[1] + box[3]) // 2])

def get_angle_between(v1, v2):
    norm_v1 = np.linalg.norm(v1)
    norm_v2 = np.linalg.norm(v2)
    if norm_v1 == 0 or norm_v2 == 0: return 180.0
    dot_product = np.dot(v1, v2)
    cos_angle = dot_product / (norm_v1 * norm_v2)
    return np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0)))

# --- 4. 블록 모델 결과 처리 및 경로 분석 ---
initial_stop_boxes, go_boxes = [], []
for box_data in results_block.boxes:
    cls_id, box = int(box_data.cls[0]), box_data.xyxy[0].cpu().numpy().astype(int)
    if cls_id == 1: initial_stop_boxes.append(box)
    else: go_boxes.append(box)
stop_boxes = merge_close_boxes(initial_stop_boxes)

# 경로 분석 및 화살표 그리기
if stop_boxes and go_boxes:
    print(f"--- 교차로 {len(stop_boxes)}개 발견. 경로 분석 시작 ---")
    for stop_box in stop_boxes:
        stop_center = get_box_center(stop_box)
        proximity_threshold = (stop_box[2] - stop_box[0]) * 3.0
        candidate_vectors = [get_box_center(go_box) - stop_center for go_box in go_boxes if 0 < np.linalg.norm(get_box_center(go_box) - stop_center) < proximity_threshold]

        if not candidate_vectors: continue

        unique_direction_groups = []
        angle_threshold = 45
        for vec in candidate_vectors:
            is_new_group = True
            for group in unique_direction_groups:
                if get_angle_between(vec, group[0]) < angle_threshold: group.append(vec); is_new_group = False; break
            if is_new_group: unique_direction_groups.append([vec])

        clustered_directions = [np.mean(group, axis=0) for group in unique_direction_groups]
        
        final_directions_to_draw = []
        if clustered_directions:
            forward_looking_directions = [vec for vec in clustered_directions if (vec / (np.linalg.norm(vec) + 1e-6))[1] < 0.5]
            if forward_looking_directions:
                anchor_vec = min(forward_looking_directions, key=lambda v: v[1])
                final_directions_to_draw.append(anchor_vec)
                for vec in forward_looking_directions:
                    if not np.array_equal(vec, anchor_vec) and get_angle_between(anchor_vec, vec) < 140:
                        final_directions_to_draw.append(vec)

        for vec in final_directions_to_draw:
            norm_vec = vec / (np.linalg.norm(vec) + 1e-6)
            endpoint = stop_center + (norm_vec * arrow_length)
            cv2.arrowedLine(output, tuple(stop_center.astype(int)), tuple(endpoint.astype(int)), (255, 255, 0), arrow_thickness, tipLength=0.25)
    cv2.putText(output, "State : Intersection", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
else:
    if go_boxes:
        all_path_points = []
        for box in go_boxes:
            x1, y1, x2, y2 = box; step = (y2 - y1) // 4
            if step > 0: all_path_points.extend([np.array([(x1+x2)//2, y1+i*step+step//2]) for i in range(4)])
            else: all_path_points.append(get_box_center(box))
        if len(all_path_points) >= 2:
            all_path_points.sort(key=lambda pt: pt[1], reverse=True)
            for i in range(len(all_path_points) - 1):
                pt1, pt2 = all_path_points[i], all_path_points[i+1]
                if pt1[1] > pt2[1]:
                    straight_arrow_thickness = max(1, arrow_thickness - 1)
                    cv2.arrowedLine(output, tuple(pt1.astype(int)), tuple(pt2.astype(int)), (255, 0, 0), straight_arrow_thickness, tipLength=0.3)
    cv2.putText(output, "State : Straight", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)


# --- 5. 스쿠터 모델 결과 처리 및 시각화 ---
print(f"--- 장애물 탐지: {len(results_scooter.boxes)}개의 잠재적 스쿠터 발견 ---")
for box in results_scooter.boxes:
    confidence = float(box.conf[0])
    if confidence > 0.5:
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
        obstacle_color = (255, 0, 255)
        cv2.rectangle(output, (x1, y1), (x2, y2), obstacle_color, arrow_thickness)
        label = f"Scooter: {confidence:.2f}"
        cv2.putText(output, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, obstacle_color, 2)


# --- 6. 신호등 존재 여부 판단 ---
signal_detected = len(results_sinho.boxes) > 0
signal_text = "Signal: Detected" if signal_detected else "Signal: Not Detected"
signal_color = (0, 200, 255) if signal_detected else (100, 100, 100)
cv2.putText(output, signal_text, (w - 310, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, signal_color, 2)
print(f"신호등 감지 여부: {signal_detected}")

# --- 7. 음향 신호기 존재 여부 판단 ---
button_detected = len(results_button.boxes) > 0
button_text = "Sound Button: Detected" if button_detected else "Sound Button: Not Detected"
button_color = (0, 255, 200) if button_detected else (100, 100, 100)
cv2.putText(output, button_text, (w - 350, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.0, button_color, 2)
print(f"음향 신호기 감지 여부: {button_detected}")

# --- 8. 결과 저장 ---
cv2.imwrite(output_path, output)
print(f"결과 이미지가 '{output_path}'에 저장되었습니다.")