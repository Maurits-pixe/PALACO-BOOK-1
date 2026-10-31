import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {validatePortableClosureBundle} from "../src/lib/portable-closure-bundle";

const file=process.argv[2];
if(!file){
  console.error("usage: npm run verify:closure-bundle -- <bundle.json>");
  process.exitCode=2;
}else{
  try{
    const input=JSON.parse(readFileSync(resolve(file),"utf8"));
    const result=validatePortableClosureBundle(input);
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.verdict==="VALID"?0:1;
  }catch(error){
    console.error(JSON.stringify({
      verdict:"INVALID",
      errors:[error instanceof Error?error.message:"BUNDLE_READ_FAILED"],
      mutationPerformed:false,
      substantiveTruthVerified:false,
      originReceiptAuthenticityVerified:false
    },null,2));
    process.exitCode=1;
  }
}
