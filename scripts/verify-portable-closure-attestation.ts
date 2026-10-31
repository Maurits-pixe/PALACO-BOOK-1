import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {verifyPortableBundleAttestation} from "../src/lib/portable-bundle-attestation";

const [bundlePath,attestationPath,publicKeyPath,keyId]=process.argv.slice(2);
if(!bundlePath||!attestationPath||!publicKeyPath||!keyId){
  console.error("usage: npm run verify:closure-attestation -- <bundle.json> <attestation.json> <public-key.pem> <key-id>");
  process.exitCode=2;
}else{
  try{
    const bundle=JSON.parse(readFileSync(resolve(bundlePath),"utf8"));
    const attestation=JSON.parse(readFileSync(resolve(attestationPath),"utf8"));
    const publicKeyPem=readFileSync(resolve(publicKeyPath),"utf8");
    const result=verifyPortableBundleAttestation(bundle,attestation,{
      [keyId]:{publicKeyPem,status:"TRUSTED"}
    });
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.verdict==="VALID"?0:1;
  }catch(error){
    console.error(JSON.stringify({
      verdict:"INVALID",
      errors:[error instanceof Error?error.message:"ATTESTATION_VERIFY_FAILED"],
      mutationPerformed:false,
      authorityGranted:false,
      substantiveTruthVerified:false
    },null,2));
    process.exitCode=1;
  }
}
