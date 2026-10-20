import { isFirestoreEnabled } from "./firestore.js";
import { FirestoreGoogleTokenRepo, InMemoryGoogleTokenRepo, type GoogleTokenRepo } from "./google-token-repo.js";

let repo: GoogleTokenRepo = isFirestoreEnabled() ? new FirestoreGoogleTokenRepo() : new InMemoryGoogleTokenRepo();

export function getGoogleTokenRepo(): GoogleTokenRepo { return repo; }
export function configureGoogleTokenRepo(next: GoogleTokenRepo): void { repo = next; }
