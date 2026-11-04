// Twenty authored silhouettes. Each map changes passages or target groups;
// no paired level is a mirror, translation or HP-only copy.
export const WALL_LEVELS = Object.freeze([
  Object.freeze({"id": "first-steps", "name": "初见", "strategy": "从下沿穿入短砖排", "rows": [".......", "..111..", ".11111."], "totalHP": 8}),
  Object.freeze({"id": "two-islands", "name": "双岛", "strategy": "分别处理左右两座小岛", "rows": [".11.11.", ".11.11."], "totalHP": 10}),
  Object.freeze({"id": "open-arch", "name": "拱门", "strategy": "利用拱门中央的入口", "rows": ["..111..", ".1...1.", "1.....1", "1.....1"], "totalHP": 12}),
  Object.freeze({"id": "rising-stairs", "name": "折阶", "strategy": "沿斜阶寻找连续反弹", "rows": ["....111", "...11..", "..11...", ".11....", "11....."], "totalHP": 14}),
  Object.freeze({"id": "hollow-diamond", "name": "菱心", "strategy": "穿过菱形内部空腔", "rows": ["...1...", "..111..", ".11.11.", "..111..", "...1..."], "totalHP": 16}),
  Object.freeze({"id": "crossroads", "name": "十字", "strategy": "从十字分叉改变出射方向", "rows": ["...1...", "..111..", "1111111", "..111..", "...1..."], "totalHP": 18}),
  Object.freeze({"id": "bridge-towers", "name": "悬桥双塔", "strategy": "从悬桥两侧进入不对称塔内", "rows": ["1....11", "11...11", ".1...1.", ".11111.", "..1.1.."], "totalHP": 20}),
  Object.freeze({"id": "fish-bone", "name": "鱼骨", "strategy": "沿主脊反弹清掉侧枝", "rows": ["...1...", ".11111.", "...1...", "..111..", "...1...", ".11111.", "...1..."], "totalHP": 22}),
  Object.freeze({"id": "keyhole", "name": "钥匙孔", "strategy": "先打开钥匙孔再清上方环", "rows": ["..111..", ".11.11.", ".1...1.", ".11.11.", "...1...", "...1..."], "totalHP": 24}),
  Object.freeze({"id": "hourglass", "name": "沙漏", "strategy": "窄腰连接上下两组目标", "rows": [".11111.", "..111..", "...1...", "..111..", ".11111."], "totalHP": 26}),
  Object.freeze({"id": "split-wings", "name": "双翼", "strategy": "左右翼需要不同入射角", "rows": ["11...11", ".11.11.", "..111..", ".11.11.", "11...11"], "totalHP": 28}),
  Object.freeze({"id": "battlements", "name": "城堡", "strategy": "从城门深入上层垛口", "rows": ["1.1.1.1", "1111111", ".1...1.", ".1...1.", ".11.11."], "totalHP": 30}),
  Object.freeze({"id": "inner-gallery", "name": "回廊", "strategy": "进入外框后的内廊", "rows": ["1111111", "1.....1", "1.111.1", "1...1.1", "111.111"], "totalHP": 32}),
  Object.freeze({"id": "staggered-gates", "name": "交错门", "strategy": "交错门要求改换进攻侧", "rows": ["1111...", "1..1111", "1.....1", "1111..1", "...1111", "..1.1.."], "totalHP": 34}),
  Object.freeze({"id": "honeycomb", "name": "蜂巢", "strategy": "连续蜂房考验小角度反弹", "rows": [".11.11.", "1..1..1", "1..1..1", ".11.11.", "1..1..1", "1..1..1", ".11.11."], "totalHP": 36}),
  Object.freeze({"id": "gearworks", "name": "齿轮", "strategy": "齿间开口通向内环", "rows": ["..1.1..", ".11111.", "11...11", ".1...1.", "11...11", ".11111.", "..1.1.."], "totalHP": 38}),
  Object.freeze({"id": "offset-scrolls", "name": "双回旋", "strategy": "沿错位回旋通路分别深入左右内室", "rows": ["111....", "..1.111", "..1.1.1", "111.1.1", "1...111", "1.111..", "111...."], "totalHP": 40}),
  Object.freeze({"id": "four-chambers", "name": "四室", "strategy": "按入口清理四个独立房间", "rows": ["111.111", "1.1.1.1", "111.111", ".......", "11...11", "1.1.1.1", ".11111."], "totalHP": 42}),
  Object.freeze({"id": "labyrinth-gate", "name": "迷宫门", "strategy": "逐层打开迷宫回转通道", "rows": ["1111111", "1......", "1.11111", "1.1...1", "1.1.1.1", "1...1.1", "111.111"], "totalHP": 44}),
  Object.freeze({"id": "crown-citadel", "name": "王冠城", "strategy": "侧门与中央塔需要组合路线", "rows": ["1..1..1", "11.1.11", "1111111", ".1.1.1.", "11...11", "1.111.1", "111.111"], "totalHP": 46}),
]);

for (const level of WALL_LEVELS) Object.freeze(level.rows);
