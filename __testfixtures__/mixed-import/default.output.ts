import { NamedGuest as Visitor } from "./lib/NamedGuest";
import { NamedAdmin } from "./lib/NamedAdmin";
import { default as MainUser } from "./lib/DefaultUser";

const main = new MainUser();
const admin = new NamedAdmin();
const visitor = new Visitor();
