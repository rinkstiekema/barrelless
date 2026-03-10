import { default as MainUser } from "./lib/DefaultUser";
import { NamedAdmin } from "./lib/NamedAdmin";
import { NamedGuest as Visitor } from "./lib/NamedGuest";

const main = new MainUser();
const admin = new NamedAdmin();
const visitor = new Visitor();
