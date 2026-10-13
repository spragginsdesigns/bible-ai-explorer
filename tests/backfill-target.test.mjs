import assert from "node:assert/strict";
import test from "node:test";
import { assertBackfillTarget } from "../scripts/lib/backfill-target.mjs";

test("only the pinned production endpoint and database pass, including its pooler",()=>{
	for(const suffix of ["","-pooler"]) assert.doesNotThrow(()=>assertBackfillTarget(`postgresql://fixture:fixture@ep-mute-waterfall-akrqxqaz${suffix}.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require`));
	for(const url of ["postgresql://fixture:fixture@other.neon.tech/neondb","postgresql://fixture:fixture@ep-mute-waterfall-akrqxqaz.c-3.us-west-2.aws.neon.tech/decoy","postgresql://fixture:fixture@ep-mute-waterfall-akrqxqaz.c-3.us-west-2.aws.neon.tech.attacker.example/neondb"]){assert.throws(()=>assertBackfillTarget(url),/Refusing backfill/);}
});
