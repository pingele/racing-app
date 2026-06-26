import type { PreSignUpTriggerHandler } from 'aws-lambda';

export const handler: PreSignUpTriggerHandler = async (event) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }
  return event;
};
