"use strict";
const fs=require("node:fs"),{spawnSync}=require("node:child_process");
const configPath=process.argv[2];if(!configPath)throw new Error("runtime config path required");
const config=JSON.parse(fs.readFileSync(configPath,"utf8"));const key=config?.stripe?.test?.secret;
if(typeof key!=="string"||!key.startsWith("sk_test_"))throw new Error("No Stripe test-mode key in approved runtime config");
const result=spawnSync(process.execPath,["--test","test-stripe/*.test.js"],{cwd:require("node:path").join(__dirname,"..","functions"),env:{...process.env,STRIPE_TEST_SECRET_KEY:key},stdio:"inherit",shell:true});
process.exit(result.status??1);
