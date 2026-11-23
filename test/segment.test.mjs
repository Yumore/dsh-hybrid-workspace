import assert from 'node:assert/strict';
import { splitSegments } from '../lib/segment.js';

const one = splitSegments('单话题：示范门店收银机掉线，帮我查 net.log 的 reconnect 记录。');
assert.equal(one.length, 1);

const blank = splitSegments('示范门店收银机掉线，帮我查 net.log。\n\n会员积分接口扣减要不要改成异步队列？');
assert.equal(blank.length, 2);
assert(blank[0].text.includes('示范门店'));
assert(blank[1].text.includes('会员积分'));

const list = splitSegments('1. 示范门店收银机掉线，帮我查 net.log。\n2. 会员积分接口要不要改成异步队列？\n3. 供应商对账差两毛三分，按单据号核对。');
assert.equal(list.length, 3);
assert(!list[0].text.startsWith('1.'));

const conn = splitSegments('示范门店收银机掉线，帮我查 net.log。另外，会员积分接口要不要改成异步队列？还有，供应商对账差两毛三分，按单据号核对。');
assert.equal(conn.length, 3);

const huashuo = splitSegments('示范门店收银机掉线，帮我查 net.log。话说，会员积分接口要不要改成异步队列？');
assert.equal(huashuo.length, 2, '话说 也要能拆出第二个话题');
assert(huashuo[1].text.includes('会员积分'));

const huashuoBack = splitSegments('示范门店收银机掉线，帮我查 net.log。话说回来，这个先不动。');
assert.equal(huashuoBack.length, 1, '话说回来不是新话题');

const inline = splitSegments('1、今天天气怎么样 2、我最近要去检查身体，做胃镜，查甲减等等。 3、餐饮项目的分析报告发我下');
assert.equal(inline.length, 3, '同一行的编号列表也要能拆');
assert(!inline[0].text.startsWith('1、'), '编号前缀应去掉');

const questions = splitSegments('示范门店收银机掉线，先查 net.log？我想知道会员积分接口要不要改异步队列。dsh-ops 是干嘛的？评估一下要不要合并？');
assert(questions.length >= 2, '连续问句要能拆');
assert(questions.some(q => q.text.includes('dsh-ops')), 'dsh-ops 独立成段');

const short = splitSegments('示范门店收银机掉线，帮我查 net.log。\n\n还有呢？');
assert.equal(short.length, 1, '短碎片不能单独建区');

const fence = String.fromCharCode(96).repeat(3);
const fenced = splitSegments('看这段日志：\n\n' + fence + '\nline one\n\nline two\n' + fence);
assert.equal(fenced.length, 1, '代码块内空行不拆');

const many = splitSegments('第一段内容足够长超过十二个字。\n\n第二段内容也足够长超过十二个字。\n\n第三段内容也足够长超过十二个字。\n\n第四段内容也足够长超过十二个字。');
assert.equal(many.length, 3);
assert(many[2].text.includes('第四段'), '超出的尾部并入最后一段');

const off = splitSegments('第一段内容足够长超过十二个字。\n\n第二段内容也足够长超过十二个字。', { multiTopic: false });
assert.equal(off.length, 1);

console.log('SEGMENT PASS');
