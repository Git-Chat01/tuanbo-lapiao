// 红线词表（v2 新增）：纯规则硬检测，不依赖模型判断
// 依据《话术库分类体系与字段模板》的红线词库 5 大类，每类挑最核心的词做 MVP 初稿。
// ⚠️ 初稿待教练审定补充（教练是领域专家，词表终版由他定）。
// 全部 ≥2 字组合词：避免单字子串误伤（如"脱"会误伤"脱口而出"）。
// 命中行为（三重闸门，见 worker/index.js 主流程）：
//   1. prompt 提醒模型指出哪句不能播（写进 redline_note）——这是教学时刻，不拒批
//   2. verdict 强制 off——绝不发"过关页+复制"鼓励发违规稿
//   3. 永不进案例库——一票否决
export const REDLINE_TERMS = [
  // 1. 色情低俗
  "裸聊", "脱光", "脱衣", "床上", "上床", "做爱", "约炮",
  // 2. 赌博诈骗 / 违规诱导消费
  "博彩", "赌博", "下注", "回本", "稳赚", "贷款", "借钱刷", "信用卡", "网贷",
  // 3. 涉政敏感
  "领导人", "国徽", "党旗", "暴动", "邪教",
  // 4. 诱导未成年消费
  "未成年", "学生党", "压岁钱", "生活费",
  // 5. 诅咒极端
  "死全家", "不得好死", "同归于尽", "跳楼", "自杀",
];

const CONTEXTUAL_TERMS = new Set(["床上", "上床", "贷款", "信用卡", "网贷", "领导人", "国徽", "党旗", "未成年", "学生党", "压岁钱", "生活费"]);
// 只允许可解释的语法衔接，不用“否定词后任意若干字”放行整段。
const PERSON = "(?:我|你们?|我们|大家|自己|主播|观众|家人们?|未成年人?|学生党|任何人|任何主播|别人)";
const MOTIVE = `(?:${PERSON}|节目|比赛|排名|冲榜|PK|这场PK|我的PK|这场比赛|这个节目)`;
const PURPOSE = `(?:(?:为了?|给|替)(?:支持|帮助|帮|讨好)?${MOTIVE}|因为?${PERSON}|以(?:支持|帮助|帮|讨好)?${PERSON}(?:为理由|为借口))`;
const NEGATION = "(?:不要|不能|不许|不准|不该|不应(?:该)?|不用|不必|无需|别|禁止|拒绝|远离|杜绝|不会|不)";
const COORDINATED_OBJECT = `(?:${REDLINE_TERMS.join("|")})(?:刷(?:礼物|票)?|礼物|票|送礼|打赏|上票)?(?:或者|或|和|、|以及)`;
const DENIED_TAIL = `(?:(?:再|去|用|拿|把|靠|搞|做|玩|动|动用|说|讲|听|进行|参与|提供|支持|提倡|鼓励|诱导|让|要求|建议|劝|教|带|自己的|你的)|${PERSON}|${PURPOSE}|${COORDINATED_OBJECT}){0,6}`;
const NEGATING_PREFIX = new RegExp(`${NEGATION}${DENIED_TAIL}[“「『\"']?$`, "u");
const DOUBLE_NEGATIVE = new RegExp(`(?:不得不|未尝不|(?:不要|不能|不许|不准|不必|别|禁止|拒绝|不接受|不会|不是|并非|没有|不代表|不意味着|不等于)${DENIED_TAIL}${NEGATION})${DENIED_TAIL}[“「『\"']?$`, "u");
const TURN = /(?:但是|不过|然而|可是|但|却|反而|还是|那就|而是|然后|接着)/u;
const REQUIRES_DENIED_ACTION = /^(?:也|是)?(?:不行|不可以|不成|不可能|不允许|才怪)/u;
const COERCIVE_CONDITION = /^(?:刷|送|打赏|上票)?(?:礼物|票)?(?:的话)?(?:[，,])?(?:那)?(?:你|我)?就(?:别来|别看|不要来|不要看|滚|退出|没(?:诚意|良心|资格)|不是(?:粉丝|真爱)|不(?:喜欢|理|唱|跳|感谢)|不能(?:进|看))/u;

function hasProtectivePrefix(before) {
  // 转折/接续后的动作需要自己有否定，不能沿用前一动作的“别”。
  const prefix = before.split(TURN).at(-1);
  const doubleNegative = prefix.match(DOUBLE_NEGATIVE);
  if (doubleNegative) {
    // “不能不借钱刷”仍诱导；“别说不能不借钱刷”则明确否定这段话。
    return NEGATING_PREFIX.test(prefix.slice(0, doubleNegative.index));
  }
  if (/(?:别信|不要信|别听|不要听|不接受|拒绝|远离)(?:那些|这种|任何)?(?:(?:让|叫|教|劝|要求|建议|鼓励|诱导)(?:你|大家|观众)|(?:他|她|别人|主播)(?:说|讲))[：:“「『"']?$/u.test(prefix)) return true;
  return NEGATING_PREFIX.test(prefix);
}

function hasProtectiveSuffix(term, after) {
  const suffix = after.split(TURN)[0];
  // 被谈及的行为本身被明确拒绝：“裸聊我们不做”“借钱刷礼物不值得”。
  const denied = suffix.match(/^(?:礼物|票)?[”」』"']?(?:(?:这|那)(?:种|样的)?(?:事|行为|话|要求|做法|套路|一套))?(?:我们|这里|我)?(?:一定|千万|绝对)?(?:不做|不提供|不参与|不能做|不要做|必须拒绝|要拒绝|别信|不要信|别碰|不要碰|不可取|是不对的|不值得|是骗人的|属于诱导消费)/u);
  if (denied && !REQUIRES_DENIED_ACTION.test(suffix.slice(denied[0].length))) return true;
  if (!["未成年", "学生党", "压岁钱", "生活费", "贷款", "信用卡", "网贷"].includes(term)) return false;
  // 消费对象后的“不消费”边界也覆盖本次对象，例如“未成年人不要把压岁钱送给我”。
  const boundary = suffix.match(new RegExp(`^(?:人|的观众|的朋友|们)?(?:请|一定|千万|都)?${NEGATION}(?:再|去|用|拿|花|为我|给我|把(?:自己的|你的)?(?:压岁钱|生活费))*(?:刷|送|打赏|消费|上票)`, "u"));
  return !!boundary && !REQUIRES_DENIED_ACTION.test(suffix.slice(boundary[0].length));
}

function isRejectedAttribution(before, after, nextClause) {
  // 只跨逗号识别明确转述+拒绝：“如果有人让你借钱刷礼物，一定别信”。
  // “如果你愿意借钱刷礼物，我就开心”没有拒绝，仍保留风险。
  if (!/(?:有人|别人|主播|他|她)(?:如果|要是)?(?:让|叫|教|劝|要求|建议|鼓励|诱导|说)[：:“「『"']?(?:你|大家|我们|观众)?/u.test(before.split(TURN).at(-1))) return false;
  const tail = (after + (nextClause ? "," + nextClause : "")).split(TURN)[0];
  return /^(?:(?:刷|送|打赏|上票)?(?:礼物|票|钱)?(?:给我|支持我)?)[”」』"']?(?:的|的话|这种话|这种要求|这一套)?(?:[，,])?(?:你|大家|我们|我)?(?:就|请|一定|千万|都)?(?:别信|不要信|不能信|别听|不要听|别搭理|不要搭理|拒绝|远离|举报|不接受|不会接受|不答应|不会答应|不要答应|不能答应)/u.test(tail);
}

/**
 * 检测未被明确保护语境否定的风险提及，其余交给模型语义评审。
 * @param {string} script - 话术全文
 * @returns {string[]} 命中的词数组（无命中返回空数组）
 */
export function detectRedline(script) {
  const sentences = String(script || "").split(/[。！？!?；;\r\n]/u).map(sentence => sentence.replace(/\s+/gu, ""));
  return REDLINE_TERMS.filter(term => sentences.some(sentence => {
    const clauses = sentence.split(/[，,]/u);
    return clauses.some((clause, clauseIndex) => {
      for (const match of clause.matchAll(new RegExp(term, "gu"))) {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + term.length);
        // 每次提及分别判定，后续重新诱导的同一个词仍会触发硬闸门。
        const continuation = after + (clauses[clauseIndex + 1] ? "," + clauses[clauseIndex + 1] : "");
        // “不借钱刷就别看”是负向条件施压，不是消费保护。
        if (!COERCIVE_CONDITION.test(continuation) && (hasProtectivePrefix(before) || hasProtectiveSuffix(term, after))) continue;
        if (isRejectedAttribution(before, after, clauses[clauseIndex + 1])) continue;
        if (CONTEXTUAL_TERMS.has(term)) {
          // 风险片段必须包含本次命中，避免同句另一处风险连带误杀普通名词。
          const risky = /(?:贷款|信用卡|网贷|压岁钱|生活费).{0,12}(?:刷|送礼|打赏|上票)|(?:刷|送礼|打赏|上票).{0,12}(?:贷款|信用卡|网贷|压岁钱|生活费)|(?:未成年|学生党).{0,12}(?:也来|也能|也要|快|都来|给我|帮我).{0,8}(?:刷|送|打赏|上票)|(?:陪你|陪我|一起|跟我|跟你)(?:在)?(?:床上|上床)/gu;
          const connected = [...clause.matchAll(risky)].some(risk => match.index >= risk.index && match.index + term.length <= risk.index + risk[0].length);
          if (!connected) continue;
        }
        return true;
      }
      return false;
    });
  }));
}
