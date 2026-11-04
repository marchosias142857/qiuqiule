// Each board is authored independently. X is an orange objective and o a
// borrowable peg; empty cells are deliberate routes, not missing random pegs.
const boards = [
  ['fan', '扇面', '先读出分开的目标，再借墙回弹', [
    '.....X.....','...X...X...','..o.....o..','.X.......X.','X....o....X','...o...o...','.....X.....']],
  ['bridge', '斜桥', '沿斜桥逐段打开上层', [
    '........X..','.......X.o.','.....X.o...','....X......','..X.o...X..','.X.o.......','X....o.....']],
  ['wings', '双翼', '左右翼之间保留穿行通道', [
    '.X.......X.','..X.....X..','o..X...X..o','.o.......o.','..X..o..X..','...o...o...','.....X.....']],
  ['gate', '门洞', '由门内进入并回弹到两边', [
    '..X.o.X.o..','..X.....X..','..X.....o..','..X.....X..','..o.....o..','.X.......X.','....o.o....']],
  ['steps', '折阶', '从开放端逐级借力', [
    '.X.X.o.....','...X.......','...X.X.o...','.....X.....','.....X.X.o.','.......o...','.o.X...X...']],
  ['lotus', '莲花', '从花瓣间空隙击入内层', [
    '.....X.....','...X.o.X...','.X..X.X..o.','X...o.o...X','.o.......o.','...X...X...','.....o.....']],
  ['pendulum', '钟摆', '绕过中央摆轴清理下弧', [
    '..X..X..o..','.....X.....','..X..o..X..','.....X.....','.X.......X.','..X.X.X.o..','....o.o....']],
  ['river', '曲流', '两条弯曲路线交替借力', [
    '.X..o...X..','..X....X...','...X..X....','....o.X....','...X...X...','..o.....X..','.X..o....o.']],
  ['windmill', '风车', '寻找四片叶片间的斜向窗口', [
    '..X.X......','....o..X.X.','X...X..o...','.o..o..o.o.','...o..X...X','.X.X..o....','......X.X..']],
  ['diamond', '空菱', '借外圈反弹回收内外目标', [
    '.....X.....','...X...X...','.X...o...X.','o..X...X..o','.X...o...X.','...X...X...','.....X.....']],
  ['cascade', '瀑布', '三股落差错开直射路线', [
    '.X...o...X.','.X..X....o.','.X...o..X..','..o..X..X..','..X..o..X..','...o.X.o...','..X.....X..']],
  ['crossroads', '交叉路', '沿斜穿路线清掉中央分叉', [
    '.X.......X.','..o..X..o..','...X.o.X...','X.o..X..o.X','...X.X.o...','..X..X..X..','.o.......o.']],
  ['keyhole', '钥匙孔', '先开外圈，再从钥匙柄入内', [
    '...X.o.X...','.X.......X.','o...X.X...o','.X.......X.','...X.X.X...','....X.o....','....X.X....']],
  ['constellation', '星群', '四组小星之间选择借墙角度', [
    'o.X......X.','.o....o.X.o','X.X.....X..','....X.o....','..o.....X.X','.X.X..X..o.','..X......X.']],
  ['double-bell', '双钟', '两座钟腔的上下窗口互补', [
    '..X.....X..','.o.X...X.o.','X...o.o...X','X...X.X...o','X.X.o.X.o.X','...X...X...','.....o.....']],
  ['crown', '王冠', '从冠脚空隙反弹到多层尖顶', [
    'X....X....X','.o...o...o.','..X..X..X..','...X...X...','.X.o.X.o.X.','..o.....o..','X..X...X..X']],
  ['spiral-door', '卷门', '开口与内卷交错，避免只打外缘', [
    '.X.o.X.o.X.','.X.......o.','.X..X.X..X.','.o..X.X..o.','.X..X....X.','.o....X.o.o','.X.o.X.....']],
  ['hourglass', '沙漏', '中央窄腰连接两层外弧', [
    'X.o.X.X.o.X','.X..o.o..X.','..o.X.X.o..','.....o.....','..X.X.X.X..','.o..X.X..o.','X.o.....o.X']],
  ['chambers', '三室', '依次打开三个不对称借力空间', [
    'X.o.X.o...X','o...X...X.o','X.o.o.o...X','....X..X.o.','.X.o..X...o','o...X...X.X','X.X.X.o...o']],
  ['star-ring', '星环', '内外错位目标需要多方向组合', [
    '...X.o.X...','.X.o.X.o.X.','o..X...X..o','X.o..o..o.X','o..X.X.X..o','.X.o...o.X.','...X.X.X...']],
];

export const PEGGLE_LEVELS = Object.freeze(boards.map(([id, name, lesson, rows], rank) => {
  const width = Math.max(...rows.map(row => row.length)), height = rows.length;
  const pegs = [];
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const cell = rows[row][column];
    if (cell === 'X' || cell === 'o') pegs.push(Object.freeze({column, row, target: cell === 'X',
      nx: column / (width - 1), ny: row / (height - 1)}));
  }
  return Object.freeze({id, name, lesson, rank, width, height, pegs: Object.freeze(pegs)});
}));

export function peggleLevel(rank) {
  return PEGGLE_LEVELS[Math.max(0, Math.min(19, Math.floor(Number(rank) || 0)))];
}
