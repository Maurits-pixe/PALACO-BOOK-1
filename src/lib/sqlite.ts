import Database from "better-sqlite3";import fs from "node:fs";import path from "node:path";
let db:Database.Database|undefined;
export function database(){if(db)return db;const file=process.env.BLUEBOOK_DB_PATH??path.join(process.cwd(),"data","bluebook.sqlite");fs.mkdirSync(path.dirname(file),{recursive:true});db=new Database(file);db.pragma("foreign_keys = ON");const migration=fs.readFileSync(path.join(process.cwd(),"db","migrations","001_initial.sql"),"utf8");db.exec(migration);return db;}
