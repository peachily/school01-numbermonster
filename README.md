# 숫자 몬스터 잡기 게임
1부터 9까지의 수 읽기 교육용 자료

---

## 실행 방법

### 1. 노트북에서 서버 실행
터미널 > HOST=0.0.0.0 node server.js

### 2. 노트북IP 확인
터미널 > ifconfig en0 | awk '/inet / {print $2}'

### 3. 각 기기에서 같은 와이파이 연결하고 아래 주소 접속

- 교사용
http://노트북IP:3000/

- 가 수준 학생 (숫자 손으로 쓰기)
http://노트북IP:3000/?screen=player&student=student-1

- 나 수준 학생 (3가지 숫자 중 선택하기)
http://노트북IP:3000/?screen=player&student=student-2

- 다 수준 학생 (소근육 운동)
http://노트북IP:3000/?screen=player&student=student-3
