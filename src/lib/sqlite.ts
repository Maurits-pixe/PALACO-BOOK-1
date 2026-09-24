import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db:Database.Database|undefined;

export function applyMigrations(target:Database.Database){
  target.pragma("foreign_keys = ON");
  const dir=path.join(process.cwd(),"db","migrations");
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith(".sql")).sort()){
    target.exec(fs.readFileSync(path.join(dir,file),"utf8"));
  }
}

export function database(){
  if(db)return db;
  const file=process.env.BLUEBOOK_DB_PATH??path.join(process.cwd(),"data","bluebook.sqlite");
  fs.mkdirSync(path.dirname(file),{recursive:true});
  db=new Database(file);
  applyMigrations(db);
  return db;
}
