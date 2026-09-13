import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { withoutOrphanedOpenAIReferences } from '../src/lib/chat/modelHistory.ts';

test('a saved answer without reasoning replays as full content through the real OpenAI adapter', async () => {
  let request;
  const provider = createOpenAI({ apiKey: 'test', fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return Response.json({ id:'resp_test', created_at:1, model:'gpt-5.6-luna', status:'completed', output:[
      { type:'message', id:'msg_reply', role:'assistant', status:'completed', content:[{ type:'output_text', text:'Follow-up answered.', annotations:[] }] },
    ], usage:{input_tokens:10,output_tokens:3,total_tokens:13} });
  } });
  const history = [
    {role:'user',content:'Explain Cana'},
    {role:'assistant',content:[{type:'tool-call',toolCallId:'call_passage',toolName:'getPassage',input:{reference:'John 2'},providerOptions:{openai:{itemId:'fc_old'}}}]},
    {role:'tool',content:[{type:'tool-result',toolCallId:'call_passage',toolName:'getPassage',output:{type:'text',value:'The passage.'}}]},
    {role:'assistant',content:[{type:'text',text:'The first answer.',providerOptions:{openai:{itemId:'msg_old',phase:'final_answer'}}}]},
    {role:'user',content:'What about the water jars?'},
  ];
  const result = await generateText({model:provider('gpt-5.6-luna'),messages:withoutOrphanedOpenAIReferences(history)});
  assert.equal(result.text,'Follow-up answered.');
  assert.equal(request.input.some(item => item.type === 'item_reference'),false);
  assert.equal(request.input.find(item => item.role === 'assistant').content[0].text,'The first answer.');
  assert.equal(request.input.find(item => item.type === 'function_call').call_id,'call_passage');
  assert.equal(request.input.find(item => item.type === 'function_call_output').output,'The passage.');
  assert.equal(history[3].content[0].providerOptions.openai.itemId,'msg_old','never alter stored history');
});

test('complete reasoning protocol blocks and other providers metadata are preserved', () => {
  const signed = {role:'assistant',content:[
    {type:'reasoning',text:'Public summary',providerOptions:{anthropic:{signature:'sig'},openai:{itemId:'rs_full'}}},
    {type:'text',text:'Answer',providerOptions:{openai:{itemId:'msg_full'}}},
  ]};
  assert.equal(withoutOrphanedOpenAIReferences([signed])[0],signed);
  const text = {role:'assistant',content:[{type:'text',text:'Answer',providerOptions:{anthropic:{signature:'retain'},openai:{itemId:'msg_old',phase:'final_answer'}}}]};
  const part = withoutOrphanedOpenAIReferences([text])[0].content[0];
  assert.deepEqual(part.providerOptions.anthropic,{signature:'retain'});
  assert.equal(part.providerOptions.openai.phase,'final_answer');
});
