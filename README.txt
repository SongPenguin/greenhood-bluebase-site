GREENHOOD VS BLUEBASE — ALL STATS VERSION

업데이트된 실제 연동 항목:
- 24H Volume
- Total Volume
- Liquidity
- Market Cap
- Holders
- Unique Traders

정의:
- Total Volume: 토큰 발행 이후 공식 풀의 ETH 측 Swap 누적 거래량
- Liquidity: ETH 가치 기준 풀 유동성
  * GreenHood V3: 현재 풀 컨트랙트의 토큰/WETH 잔액 기반
  * BlueBase V4: ModifyLiquidity 이벤트로 복원한 원금 유동성 추정치. 미수령 수수료 제외. 사이트에는 ~ 표시
- Market Cap: 현재 풀 가격 × 총 공급량, ETH 기준
- Holders: Transfer 이벤트로 복원한 현재 양수 잔액 주소 수
- Unique Traders: 공식 풀 Swap 트랜잭션의 tx.from 고유 주소 수(누적)

GitHub에서는 반드시 다음 구조를 유지하세요:
api/
  battle.js
assets/
  greenhood-knight.png
  bluebase-knight.png
index.html
script.js
style.css
package.json
vercel.json
