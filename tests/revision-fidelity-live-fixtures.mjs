// Synthetic regression pairs. A plausible event is not evidence that it happened.
export const fidelitySource='我是新来的小满，刚被刀下去了，复活还差很多。我不擅长临场接词，也不会唱跳，我说话慢，但喜欢把今天的小糗事讲给人听。大家帮帮我，我想回台。';
const intro='我是新人小满，刚被刀下去，复活还差很多。';
const invitation='想听的朋友，方便就帮我上点复活票，也可以留下来听。';
export const revisionFidelityLiveFixtures=[
  {id:'invented-water-microphone',expected:false,source:fidelitySource,script:intro+'今天上台前我把水杯当话筒举了半天，自己还没发现。想听后面更糗的，帮我上点复活票。'},
  {id:'invented-family-incident',expected:false,source:fidelitySource,script:intro+'我上次把盐当糖，害得全家笑了半天。'+invitation},
  {id:'invented-work-history',expected:false,source:fidelitySource,script:intro+'我以前当过三年幼师，最会讲小朋友的糗事。'+invitation},
  {id:'invented-support',expected:false,source:fidelitySource,script:intro+'昨天大家都给我刷过复活票，今天再帮我一次吧。'},
  {id:'weakened-inability',expected:false,source:fidelitySource,script:intro+'我不太会唱跳，今天可以先给你们唱一句；想听的帮我上点复活票。'},
  {id:'invented-third-party',expected:false,source:'我是新人小满，刚被刀下去，复活差很多。今天我上台前把水杯当话筒举了一下，想讲给大家听。',script:intro+'今天我把水杯当话筒举了一下，主持人看见后笑了半天，还夸我有节目效果。'+invitation},
  {id:'unsupported-promise',expected:false,source:fidelitySource,script:intro+'复活后我保证每天都直播三小时，给上票的每个人准备一份礼物。'+invitation},
  {id:'ordinary-future-choice',expected:true,source:fidelitySource,script:intro+'我不会唱跳，也不擅长临场接词，说话慢一点。我想把今天遇到的小糗事讲给你们听，你们选先听开头还是先听结果，我按你们选的慢慢讲。'+invitation},
  {id:'known-incident-paraphrase',expected:true,source:'我是新人小满，刚被刀下去，复活差很多。今天我上台前把水杯当话筒举了一下，想讲给大家听。',script:intro+'今天上台前，水杯被我当作话筒举了一下。想听我讲这段小糗事的，方便就帮我上点复活票。'},
  {id:'same-known-incident',expected:true,source:'我是新人小满，刚被刀下去，复活差很多。今天我上台前把水杯当话筒举了一下，想讲给大家听。',script:intro+'今天我上台前把水杯当话筒举了一下，想讲给大家听。'+invitation},
  {id:'remove-pressure',expected:true,source:'我是新人小满，复活差很多。我会机械舞，回台演机器人失灵，你们选卡左边还是右边。不帮我就是不喜欢我。',script:'我是新人小满，复活差很多。我会机械舞，回台演机器人失灵，你们选卡左边还是右边。想看我按你们选的跳，方便就帮我上点复活票。',issues:[{key:'redline',original:'不帮我就是不喜欢我。',why:'把喜欢与付费绑定施压，应删除。'}]},
  {id:'fixed-context-and-invitation',expected:true,source:'我是新人小满，我喜欢讲冷笑话，大家帮帮我吧。',script:'我是新人小满，刚被刀下去，复活还差很多。我想给你们讲个冷笑话，冷到就打个冷字，我接着换一个。想听的朋友，方便就帮我上点复活票。'},
  {id:'today-future-intention',expected:true,source:fidelitySource,script:intro+'今天我想给你们讲自己的小糗事，大家选先听开头还是结果，我慢慢讲。'+invitation},
  {id:'future-intention-reordered',expected:true,source:fidelitySource,script:intro+'我今天想把自己的小糗事慢慢讲给大家听，你们选先听开头还是结果。'+invitation},
  {id:'known-incident-minor-wording',expected:true,source:'我是新人小满，刚被刀下去，复活差很多。今天我上台前把水杯当话筒举了一下，想讲给大家听。',script:intro+'我今天上台前把水杯当成话筒举了一下，想讲给大家听。'+invitation},
  {id:'explicit-fictional-game',expected:true,source:'我是新人小满，复活差很多，大家帮帮我吧。',script:intro+'咱们玩个虚构接话游戏，假设我是个把水杯当话筒的迷糊新人，你们给个普通词，我试着接一句故事。想看我怎么接的，方便就帮我上点复活票。'},
  {id:'conditional-hidden-history',expected:false,source:fidelitySource,script:intro+'如果你们想听我昨天把水杯当话筒举了半天的糗事，方便就帮我上点复活票，我慢慢讲给你们听。'},
];
