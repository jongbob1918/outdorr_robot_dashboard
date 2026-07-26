# outdorr_robot_dashboard

국가 공간정보로 서오릉을 시각화하고 로봇 SLAM 맵과 포즈 발행 UI를 단계별로
검증하는 브라우저 프로토타입입니다.

## 실제 사용 데이터

이 프로젝트의 배경 데이터는 OpenStreetMap이나 Google 지도가 아닙니다.

1. 국토교통부 국토지리정보원
   - 2024 항공사진 영상지도
   - WMTS 타일 81장을 내려받아 2,304×2,304 JPEG로 결합
2. 국가유산청 국가유산공간정보서비스
   - `고양 서오릉` 지정유산 SHP
   - 원본 좌표계 EPSG:5179를 WGS84 GeoJSON으로 변환
   - 속성 면적 1,883,765㎡

원본·가공 결과:

- `data/raw/national-heritage/seooreung-designated-heritage.zip`
- `public/data/seooreung-ngii-air-2024.jpg`
- `public/data/seooreung-national-heritage.geojson`
- `public/data/seooreung-national-data.json`

MapLibre는 위 파일을 WebGL로 그리는 렌더러로만 사용하며 지도 데이터 공급자가
아닙니다.

## 테스트 단계

- 1단계: 국토지리정보원 항공사진과 국가유산청 서오릉 경계만 표시
- 2단계: 실제 항공사진 위에 로봇 SLAM 맵과 경로를 정렬하고 표시/숨김
- 3단계: 로봇 포즈, 키보드 조작, 10Hz 발행/중단, 접이식 테스트 사이드바

단계별 완료 기준은 화면 표시뿐 아니라 브라우저 조작 테스트 통과입니다.

## 실행

```bash
npm install
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm run start:vinext
```

국가 원본에서 가공 파일을 다시 생성하려면 `unzip`과 ImageMagick의 `montage`가
설치된 환경에서 실행합니다.

```bash
npm run sync:data
```

## 상업적 이용 요약

- 저장소의 애플리케이션 코드는 MIT License로 상업적 이용이 가능합니다.
- 국가유산청 지정유산 SHP는 공공데이터포털에 무료, `이용허락범위 제한 없음`으로
  표시됩니다.
- 국토지리정보원 정사영상 TIFF도 무료, `이용허락범위 제한 없음`으로 표시됩니다.
- 국토지리정보원 영상지도·배경지도 API는 공공누리 제1유형으로 상업적 이용이
  가능하지만 출처표시, 회원용 인증키, 트래픽 정책과 제3자 권리를 확인해야 합니다.

현재 프로토타입의 항공사진 모자이크는 영상지도 WMTS에서 만든 테스트 결과입니다.
상용 배포에서는 본인 명의 API 키를 발급받거나, 국토정보플랫폼에서 서오릉
정사영상 TIFF를 직접 내려받아 같은 로컬 이미지 슬롯에 교체하는 것이 안전합니다.

권장 출처표시:

> 영상 © 국토교통부 국토지리정보원 / 경계 © 국가유산청

상세 검토는 [LICENSING.md](./LICENSING.md)를 참고하세요.
