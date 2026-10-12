// Synthetic text only, shared by the offline route and UI tests.
export const originalScript = "我是新人小禾，复活差很多。大家帮我上复活票吧。";
export const revisedScript = "我是新人小禾，复活差很多。你们给个普通词，我接一句打招呼，想听的朋友帮我上点复活票。";
export const ask = "大家帮我上复活票吧。";
export const example = "你们给个普通词，我接一句打招呼，想听的朋友帮我上点复活票。";
export function fixtureReport(script = originalScript, passed = false) {
  return {card_type:"logic",card_why:passed ? "给词接话的参与内容和复活邀请已经说清。" : "只有自己的需要，还没给观众可参与的内容。",
    audience:"刚进房的观众",verdict:passed ? "passed" : "almost",
    verdict_reason:passed ? "参与内容和复活邀请已经说清，可以开口练。" : "还需说明观众可以参与的具体内容。",
    echo:"复活请求已经说清。",one_thing:passed ? "保留这版，开口看回应。" : "补具体互动。",ai_flavor:"",redline_note:"",
    structure_checks:["self_intro","gratitude","target_user","user_reason","vote_instruction"].map(key=>({key,status:!passed && key==="user_reason"?"partial":"met",evidence:script})),
    line_reviews:(script.match(/[^。]+。?/g)||[script]).map(original=>({original,mark:"good",comment:"说明处境和邀请。"})),
    interaction_review:{signal_refs:["script:0"],script_refs:[0],judgment:"aligned",reading:"向陌生观众发出复活邀请。",why:passed?"观众给词，主播接话。":"还缺具体参与内容。",next_check:"看观众是否给词，再接话。"},
    round_dynamics:{flow_read:"说明处境并请求复活",human_drivers:[{driver:"control",evidence:passed?example:script,mechanism:passed?"观众可以给词参与主播接话。":"直接请求支持"}],response_read:"没有实际回应",next_move:passed?"按真实回应接话。":"补参与内容。"},
    coaching:{focus_key:passed?"final_polish":"user_reason",keep:"保留复活请求。",original:passed?example:ask,
      action:passed?"保留这版，开口练并观察回应":"补一个能当下接的互动。",example,why:"原来只有你的需要，改后说明观众做什么、你接什么。"}};
}
