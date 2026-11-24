# 서울 유동인구 · 3D 시티맵

서울 생활인구(행정동, 2025.08–2026.07 평균)를 건물 262,694동·도로 79,413개 위에 얹은
웹GL 3D 지도입니다. 시간(00–24시)·평일/주말 슬라이더로 도로 유동인구(번잡도)를 색·굵기·발광으로
보여주고, 해가 지면 야간 팔레트와 창문 불빛·도로 글로우로 전환됩니다.

- `index.html`, `app.js` — 화면과 지도 로직 (MapLibre GL JS 5)
- `data/buildings.bin` — 건물 footprint(int16)·높이·색상 카테고리
- `data/roads.bin` — 도로 폴리라인 + 24시간×평일/주말 혼잡도(4bit 니블)
- `data/lights.bin` — 야간 창문 불빛 포인트
- `data/water.json` — 한강·지천 폴리곤
- `build_data.py` — 원본 OSM 데이터에서 위 바이너리를 만드는 스크립트

데이터 출처: 건물·도로 © OpenStreetMap 기여자, 배경 OpenFreeMap, 지형 AWS Terrain Tiles,
생활인구 서울 열린데이터광장 OA-14991.
