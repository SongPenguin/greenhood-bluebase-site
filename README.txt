GREENHOOD VS BLUEBASE — LIVE VERSION

이 버전은 다음 온체인 데이터를 연결합니다.

GreenHood
- Robinhood Chain
- Token: 0x2774570eac3F633460dFD2bBA14fb08CabF24663
- Uniswap V3 Pool: 0xe436aACf983A3C1323ECD2641F8f956Ad8f5bde1

BlueBase
- Base
- Token: 0xB20000000000000000000078118fD5c63cDa3e01
- Uniswap V4 PoolManager: 0x498581fF718922c3f8e6A244956aF099B2652b2b
- Pool ID: 0x4F12EB8FCE0134F3901424915741EAE32100A0A611F5504F40D4562251D0A2D7

현재 구현
- GreenHood V3 Swap 이벤트의 ETH/WETH 쪽 거래량 합산
- BlueBase V4 PoolManager Swap 이벤트 중 해당 Pool ID만 필터링
- 최근 24시간 ETH 거래량 계산
- 30초마다 웹 화면 자동 갱신
- API 응답 Vercel CDN 캐시 30초

아직 미구현
- Total Volume (전체 누적 거래량)
- Liquidity
- Market Cap
- Holders
- Unique Traders

배포
1. 이 ZIP을 Vercel Drop에 업로드합니다.
2. Vercel이 package.json의 ethers를 자동 설치하고 /api/battle 함수를 배포합니다.
3. 배포 완료 후 사이트를 열고 30~60초 기다립니다.
4. 값이 ERR 또는 Partial data라면 RPC 제한 가능성이 있습니다.

선택 환경변수
- ROBINHOOD_RPC_URL
- BASE_RPC_URL

기본값은 각 체인의 공개 RPC입니다. 트래픽이 늘면 Alchemy 등 전용 RPC를 환경변수로 설정하는 편이 안정적입니다.
