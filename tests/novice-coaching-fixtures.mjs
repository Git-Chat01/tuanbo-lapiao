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
