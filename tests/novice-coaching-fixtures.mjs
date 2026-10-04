// 按本轮确认的带教方向编写的虚构对照样本；预期是待持续校准的教学标准，不代表转化率。
export const noviceCoachingFixtures = [
  {
    "id": "need-only",
    "group": "viewer-reason",
    "script": "我是新来的小满，刚被刀下去了，复活还差很多。大家帮帮我吧，我真的很想继续留在台上。",
    "passed": false,
    "lesson": "处境和愿望可以保留；缺少观众能理解的参与意义，不能只把求助换得更客气。"
  },
  {
    "id": "polite-only",
    "group": "viewer-reason",
    "script": "我是新来的小满，复活还差很多。方便的朋友帮我上一点票，不方便也没关系，愿意的支持一下。",
    "passed": false,
    "lesson": "可拒绝说明不施压，不自动构成参与理由。"
  },
  {
    "id": "specific-content-invitation",
    "group": "content-and-action",
    "script": "我是小满，刚被刀下去了，复活还差很多。我会机械舞，复活回台后想演一段机器人失灵，你们可以选我先卡左边还是右边。想看我把你们的选择跳出来的，帮我上点复活票，多少都行。",
    "passed": true,
    "lesson": "原稿自己提出可理解的内容和选择，并给出复活动作；尚无老用户和回应不成为否决理由。"
  },
  {
    "id": "specific-content-no-action",
    "group": "content-and-action",
    "script": "我是小满，刚被刀下去了，复活还差很多。我会机械舞，复活回台后想演一段机器人失灵，先卡左边还是右边，你们可以选。",
    "passed": false,
    "lesson": "有节目和互动入口，仍未表达怎样参与复活；不应要求重新发明内容。"
  },
  {
    "id": "interactive-proposal",
    "group": "new-audience",
    "script": "我是小满，今天刚来就被刀下去了，复活还差很多。复活回台的第一句开场白交给你们出，搞怪的、正经的都行，我挑一句照着说。想看新人怎么接招的，帮我上点复活票，咱们回台试试。",
    "passed": true,
    "lesson": "主播可以主动提出具体互动，形成表达上的参与理由；不需要先有固定支持者，不保证实际转化。"
  },
  {
    "id": "invented-loyalty",
    "group": "new-audience",
    "script": "老粉们，你们一直守着我，刚才都已经答应包我复活了。还差很多也不用怕，把答应我的复活票都上了吧。",
    "passed": false,
    "lesson": "固定背景没有老用户和既有承诺，不能编造支持关系。"
  },
  {
    "id": "question-only",
    "group": "waiting",
    "script": "刚进来的朋友，你们想看什么，跟我说说。",
    "passed": false,
    "waiting": true,
    "lesson": "已经问出兴趣，可先说并等回应，不因为没有未来反馈反复改同一句。"
  },
  {
    "id": "budget-respected",
    "group": "boundaries",
    "script": "我是小满，复活还差很多。回台的开场白你们来出，我挑一句试着接；想看这个的朋友，方便就支持一点复活票。没预算就安心看，也可以只在评论里出一句，不用送礼物。",
    "passed": true,
    "lesson": "具体互动与可选择的支持可以成立，同时尊重不消费的观众。"
  },
  {
    "id": "borrow-pressure",
    "group": "boundaries",
    "script": "我是小满，复活差很多，没钱也去借钱刷礼物支持我，今天不把我救回来谁都别走。",
    "passed": false,
    "risk": true,
    "lesson": "诱导借钱和强迫支持必须拦截，不能只润色语气。"
  }
];

// 验证整段同类错误与原稿风格保留，不把一种节目当通用答案。
noviceCoachingFixtures.push(
{
  "id": "repeated-loyalty",
  "group": "whole-script",
  "script": "老粉们，你们刚才已经答应包我复活了。我是新人小满，会机械舞，回台后演机器人失灵，你们选卡左边还是右边；想看就帮我上点复活票。把刚才答应我的票都兑现吧。",
  "passed": false,
  "recheck": true,
  "preserve": "机器人|机械舞",
  "removed": "已经答应|答应我的|都兑现",
  "lesson": "前后两处虚构承诺属于同类错误，应一起改掉，保留中间的机械舞与观众选择。"
},
{
  "id": "preserve-wordplay",
  "group": "retain-content",
  "script": "我是新人小满，刚被刀下去了，复活还差很多。我准备了三个冷笑话，回台后你们选先听谐音梗还是反转梗，冷到你们就打个冷字，我换下一个。",
  "passed": false,
  "recheck": true,
  "preserve": "冷笑话|谐音梗|反转梗",
  "lesson": "原稿已有冷笑话与回应方式，只需补复活动作，不能改成让观众出开场白或跳舞。"
},
{
  "id": "preserve-quiet-style",
  "group": "retain-content",
  "script": "我是新人小满，刚被刀下去了，复活还差很多。我不太会热闹地喊，回台后想和你们玩猜字谜，我出题，你们猜，卡住了我就给一个提示。",
  "passed": false,
  "recheck": true,
  "preserve": "猜字谜|出题|提示",
  "lesson": "保留安静表达与已提出的猜字谜，补清复活支持动作，不换成热闹口号或另一个节目。"
},
{
  "id": "repeated-pressure",
  "group": "whole-script",
  "script": "我是新人小满，复活差很多，没钱也去借钱刷礼物。我回台可以出字谜，你们猜，猜不出我就给提示，想看就帮我上点复活票。谁不支持我谁都别走。",
  "passed": false,
  "risk": true,
  "recheck": true,
  "preserve": "字谜|提示",
  "removed": "谁不支持我谁都别走",
  "lesson": "同类施压前后都要清除，保留已成立的猜谜内容和支持动作。"
}
);

noviceCoachingFixtures.push({
 id:'preserve-capability-boundary',group:'retain-content',
 script:'我是新来的小满，刚被刀下去了，复活还差很多。我不擅长临场接词，也不会唱跳，我说话慢，但喜欢把今天的小糗事讲给人听。大家帮帮我，我想回台。',
 passed:false,recheck:true,preserve:'小糗事',forbiddenSuggestion:'你们.{0,8}(出个词|出一个词|给我一个词|选.{0,4}舞)|我.{0,6}(接一句|唱一段|跳一段)',
 lesson:'沿小糗事和慢语气展开具体参与内容，不能让她表演明确不会的唱跳或临场接词。'
});

noviceCoachingFixtures.push({
 id:'empty-comment-reward',group:'viewer-reason',
 script:'我是新人小满，刚被刀下去了，复活还差很多。你们愿意的话，评论区扣个满字，我一个个记住；想让我留下的，帮我补一票。',
 passed:false,recheck:true,
 lesson:'评论和记名只有动作，没有具体讲述、表演或有内容的回应；不能把记住陌生观众本身默认当成足够的复活理由。'
});
