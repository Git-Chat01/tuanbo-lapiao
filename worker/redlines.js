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

/**
 * 检测话术命中的红线词。
 * @param {string} script - 话术全文
 * @returns {string[]} 命中的词数组（无命中返回空数组）
 */
export function detectRedline(script) {
  const s = String(script || "");
  // 名词本身不是违规行为。这里只拦有明确风险的表达，其余交给语义评审。
  const contextual = new Set(["床上", "上床", "贷款", "信用卡", "网贷", "领导人", "国徽", "党旗", "未成年", "学生党", "压岁钱", "生活费"]);
  const clauses = s.split(/[，,。！？!?；;\r\n]/u);
  return REDLINE_TERMS.filter(term => clauses.some(clause => {
    for (const match of clause.matchAll(new RegExp(term, "gu"))) {
      const before = clause.slice(0, match.index);
      const after = clause.slice(match.index + term.length);
      // 只消除本次提及；后半句再次诱导仍单独检测，不用整稿“有不要就放行”。
      if (/(?:不要|不能|不许|不准|别|禁止|拒绝|远离|杜绝)(?:去|再|用|拿|靠|搞|说|讲|提倡|鼓励|诱导|让大家)?[“「"']?$/u.test(before)) continue;
      if (/^(?:人|的观众|的朋友|们)?(?:千万)?(?:不要|不能|不许|别|禁止)(?:再|去)?(?:刷|送|打赏|消费|上票)/u.test(after)) continue;
      if (["压岁钱", "生活费"].includes(term) && /(?:留好|留着|保管好|保留|别动|不要动)(?:自己的|你的|好自己的)?$/u.test(before)) continue;
      if (contextual.has(term)) {
        // 只有词与消费/色情动作明确相连才触发硬闸门；普通叙述不作裁决。
        const risky = /(?:贷款|信用卡|网贷|压岁钱|生活费).{0,12}(?:刷|送礼|打赏|上票)|(?:刷|送礼|打赏|上票).{0,12}(?:贷款|信用卡|网贷|压岁钱|生活费)|(?:未成年|学生党).{0,12}(?:也来|也能|也要|快|都来|给我|帮我).{0,8}(?:刷|送|打赏|上票)|(?:陪你|陪我|一起|跟我|跟你)(?:在)?(?:床上|上床)/u;
        if (!risky.test(clause)) continue;
      }
      return true;
    }
    return false;
  }));
}
