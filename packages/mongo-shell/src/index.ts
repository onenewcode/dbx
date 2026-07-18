export {
  chainedMethodCallPattern,
  escapeRegExp,
  findChainedMethodCallIndex,
  findMatchingParen,
  hasUnclosedMongoDelimiters,
  normalizeJsonArgument,
  parseCollectionMethodTarget,
  parseMongoDocumentArgument,
  parseMongoDocumentArrayArgument,
  parseMongoInsertDocumentsArgument,
  parseMongoObjectArgument,
  quoteUnquotedObjectKeys,
  splitTopLevel,
  trimMongoOuterComments,
} from "./json.js";

export { describeMongoCommandParseFailure, MONGO_SHELL_COMMAND_HINT, parseMongoAggregateCommand, type MongoAggregateCommand } from "./aggregate.js";
