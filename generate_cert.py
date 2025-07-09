import os
import subprocess
import sys

def generate_certificate():
    """간단한 자체 서명 SSL 인증서 생성 (OpenSSL 사용)"""
    
    # cert 디렉토리 생성
    cert_dir = "cert"
    if not os.path.exists(cert_dir):
        os.makedirs(cert_dir)
    
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")
    
    # 이미 인증서가 있으면 건너뛰기
    if os.path.exists(cert_path) and os.path.exists(key_path):
        print("SSL 인증서가 이미 존재합니다.")
        return cert_path, key_path
    
    try:
        # OpenSSL을 사용한 자체 서명 인증서 생성
        cmd = [
            'openssl', 'req', '-x509', '-newkey', 'rsa:4096', '-keyout', key_path,
            '-out', cert_path, '-days', '365', '-nodes', '-subj',
            '/C=KR/ST=Seoul/L=Seoul/O=BlindRoadHelper/CN=localhost'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("SSL 인증서가 성공적으로 생성되었습니다:")
            print(f"- 인증서: {cert_path}")
            print(f"- 개인키: {key_path}")
        else:
            print(f"OpenSSL 오류: {result.stderr}")
            # 대체 방법: 파이썬으로 간단한 인증서 생성
            create_simple_cert(cert_path, key_path)
            
    except FileNotFoundError:
        print("OpenSSL을 찾을 수 없습니다. 간단한 인증서를 생성합니다.")
        create_simple_cert(cert_path, key_path)
    
    return cert_path, key_path

def create_simple_cert(cert_path, key_path):
    """간단한 더미 인증서 생성 (개발 전용)"""
    
    # 더미 개인키 생성
    dummy_key = """-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7vJwuC9x3yVXL
-----END PRIVATE KEY-----"""
    
    # 더미 인증서 생성
    dummy_cert = """-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKoK/hnyHbpWMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
-----END CERTIFICATE-----"""
    
    try:
        with open(key_path, 'w') as f:
            f.write(dummy_key)
        
        with open(cert_path, 'w') as f:
            f.write(dummy_cert)
        
        print("경고: 더미 인증서가 생성되었습니다. 프로덕션 환경에서는 사용하지 마세요.")
        
    except Exception as e:
        print(f"인증서 생성 실패: {e}")
        sys.exit(1)

if __name__ == "__main__":
    generate_certificate()
