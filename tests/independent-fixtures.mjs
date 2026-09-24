// Independently authored, synthetic counterfactuals. Do not add user drafts here.
// Each pair isolates one decisive scene relationship, stage, or expression.
// Expected passes are editorial hypotheses about the known scene, not proof of conversion.
const twoOpen = {phase:"pledging",targetUnits:10,pledgedUnits:8,openRemaining:2,deliveredUnits:0,targetUser:"阿沐"};
const finalOpen = {phase:"closing",targetUnits:10,pledgedUnits:9,openRemaining:1,deliveredUnits:0,targetUser:"阿沐"};
const watchScript = "欢迎阿沐，我是小鹭。你刚说想看我跳完后半段，我也想把它跳完。这轮还差两手，你想接一手陪我把这段看完吗？不想也可以先看。";
const finalSlotScript = "九手已经有人站上了，现在只剩最后一个位置。阿沐，你想把收尾这一手接上吗？我记好后等主持统一喊。";
const politeScript = "阿沐，现在你方便吗？不方便也没关系，我继续问其他人。";
const deliveryScript = "谢谢阿沐，你刚才接的三手已经到账了，我看到进度往前走了。还差最后一手，愿意的朋友谁来接这个位置？";
const resultScript = "这轮我们已经守住了，谢谢刚才一手一手帮我站位的朋友。下一段我继续跳，先让大家喘口气。";
const singingScript = "阿沐，你刚想听我唱一句，我现在唱一段给你听；好玩你再决定要不要搭这一手。";
export const independentFixtures = [
  {id:"viewer-said-watch",pair:"viewer-vs-host",passed:true,judgment:"aligned",script:watchScript,scenario:{...twoOpen,id:"ind-viewer-said-watch",userSignal:"阿沐刚在公屏说：后半段还跳吗？我想看。尚未认领。",hostCue:"主持只报还差两手。"}},
  {id:"host-guessed-watch",pair:"viewer-vs-host",passed:false,judgment:"misread",script:watchScript,scenario:{...twoOpen,id:"ind-host-guessed-watch",userSignal:"阿沐刚进房，只发了你好，没有说想看舞，也没认领。",hostCue:"主持猜阿沐可能想看后半段，但并未转述阿沐的话。"}},

  {id:"real-final-slot",pair:"real-vs-invented-group",passed:true,judgment:"aligned",script:finalSlotScript,scenario:{...finalOpen,id:"ind-real-final-slot",userSignal:"阿沐刚进房，尚未认领。",hostCue:"主持确认前九手已有人认领，目前只缺最后一手。"}},
  {id:"invented-final-slot",pair:"real-vs-invented-group",passed:false,judgment:"misread",script:finalSlotScript,scenario:{...finalOpen,id:"ind-invented-final-slot",phase:"pledging",pledgedUnits:0,openRemaining:10,userSignal:"阿沐刚进房，尚未认领。",hostCue:"主持只说刚开始组队，十手都还没有人认领。"}},

  {id:"answer-volunteered-help",pair:"response-vs-polite-reask",passed:true,script:"阿沐，你刚问怎么帮，这轮还差十手，你先认一手就行，我记好等主持喊；想先看也可以。",scenario:{phase:"pledging",targetUnits:10,pledgedUnits:0,openRemaining:10,targetUser:"阿沐",id:"ind-answer-help",userSignal:"阿沐刚主动说：我想帮你把这轮接下去，现在我怎么做？",hostCue:"主持刚解释一手是一个占位，认领后等统一口令再送。"}},
  {id:"polite-reask-to-volunteer",pair:"response-vs-polite-reask",passed:false,script:politeScript,scenario:{phase:"pledging",targetUnits:10,pledgedUnits:0,openRemaining:10,targetUser:"阿沐",id:"ind-polite-reask",userSignal:"阿沐刚主动说：我想帮你把这轮接下去，现在我怎么做？",hostCue:"主持刚解释一手是一个占位，认领后等统一口令再送。"}},

  {id:"gift-was-delivered",pair:"pledge-vs-delivery",passed:true,judgment:"aligned",script:deliveryScript,scenario:{...finalOpen,id:"ind-gift-delivered",deliveredUnits:3,recentGift:"阿沐刚把先前认领的三手实际送出并到账；尚余1个占位。"}},
  {id:"only-pledged-not-delivered",pair:"pledge-vs-delivery",passed:false,judgment:"misread",script:deliveryScript,scenario:{...finalOpen,id:"ind-only-pledged",recentGift:"阿沐只口头认领三手，主持尚未喊丢，暂未到账。"}},

  {id:"confirmed-result",pair:"result-vs-unconfirmed",passed:true,judgment:"aligned",script:resultScript,scenario:{phase:"result",id:"ind-result-confirmed",targetUnits:10,pledgedUnits:10,openRemaining:0,deliveredUnits:10,hostCue:"主持宣布本轮已经守住，结果确认。"}},
  {id:"result-not-confirmed",pair:"result-vs-unconfirmed",passed:false,judgment:"misread",script:resultScript,scenario:{phase:"delivery",id:"ind-result-unconfirmed",targetUnits:10,pledgedUnits:10,openRemaining:0,deliveredUnits:2,hostCue:"主持刚喊统一丢票，尚未确认到账数和结果。"}},

  {id:"singing-was-requested",pair:"interest-vs-refusal",passed:true,judgment:"aligned",script:singingScript,scenario:{phase:"revival_offer",id:"ind-singing-requested",targetUser:"阿沐",userSignal:"阿沐刚说：你唱一句，我就考虑搭一手。"}},
  {id:"singing-was-refused",pair:"interest-vs-refusal",passed:false,judgment:"misread",script:singingScript,scenario:{phase:"revival_offer",id:"ind-singing-refused",targetUser:"阿沐",userSignal:"阿沐刚说：别唱，我今天不想听歌。"}},

  {id:"one-contextual-invitation",pair:"single-vs-hollow-repeat",passed:true,script:"刚跳完这一段，前面九手都有人接了。阿沐，最后这个位置你想一起收一下吗？我记好等主持发令。",scenario:{...finalOpen,id:"ind-one-invitation",userSignal:"阿沐刚问：现在还差多少？",hostCue:"主持确认前九手已有认领，目前还差一手。"}},
  {id:"hollow-repeat-pressure",pair:"single-vs-hollow-repeat",passed:false,script:"帮我组一组，就差最后一点！帮我组一组，就差最后一点！来来来别停，继续上，我不能输！",scenario:{phase:"pledging",id:"ind-hollow-repeat",targetUnits:10,pledgedUnits:0,openRemaining:10,hostCue:"当前尚未开始表演，主持确认十手都还没有人认领。"}},

  {id:"honor-viewing-only",pair:"budget-boundary",passed:true,judgment:"aligned",script:"阿沐，收到，这轮你先看就好。刚才那段你觉得哪一拍好看，等会儿告诉我；这轮还差最后一手，想接的朋友出个声，我记好等主持喊。",scenario:{...finalOpen,id:"ind-honor-budget",userSignal:"阿沐刚说：今天到预算上限了，这轮只看，不送礼。"}},
  {id:"ignore-viewing-only",pair:"budget-boundary",passed:false,judgment:"misread",script:"阿沐，你都看到这儿了就帮我上最后一手吧，别让我白跳。",scenario:{...finalOpen,id:"ind-ignore-budget",userSignal:"阿沐刚说：今天到预算上限了，这轮只看，不送礼。"}},

  {id:"one-real-ask-with-performance",pair:"real-progress-vs-dense-empty-pk",passed:true,script:"刚跳完这一段，九手已经有人接了，还差最后一手。阿沐，你想接这一手吗？我记好等主持喊。",scenario:{...finalOpen,id:"ind-performance-once",roleContext:"主播刚完整跳完一段舞，现在在真实组队阶段。",hostCue:"主持确认前九手已认领，目前只差一手。"}},
  {id:"dense-empty-pk",pair:"real-progress-vs-dense-empty-pk",passed:false,verdict:"off",coachingNeed:"content-before-ask",script:"还差最后一点，帮我组一组！还差最后一点，帮我组一组！来来来继续上！还差最后一点，帮我组一组！别停，继续上，不能输！",scenario:{...finalOpen,id:"ind-dense-empty-pk",roleContext:"本轮已经连续五分钟没有实质表演，只有反复喊票的PK。",hostCue:"主持确认前九手已认领，目前只差一手。"}},
];
