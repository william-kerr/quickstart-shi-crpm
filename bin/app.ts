#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CicdStack } from '../lib/ci-cd-stack';
import { IdeStack } from '../lib/ide-stack';

const app = new cdk.App();
new CicdStack(app, 'quickstart', {
  stackName: 'quickstart-shi-crpm-ci-cd',
  description: 'Infrastructure CI-CD quick start'
});
new IdeStack(app, 'ide', {
  stackName: 'quickstart-shi-crpm-ide',
  description: 'Cloud9 IDE with crpm pre-installed and quick start code checked out'
});
