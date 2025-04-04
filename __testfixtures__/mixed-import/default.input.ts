import MainUser, { NamedAdmin, NamedGuest as Visitor } from "./lib";

const main = new MainUser();
const admin = new NamedAdmin();
const visitor = new Visitor();
