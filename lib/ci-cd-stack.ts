import * as cdk from '@aws-cdk/core';
import * as cfn from '@aws-cdk/aws-cloudformation';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as events from '@aws-cdk/aws-events';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3 from '@aws-cdk/aws-s3';
import * as crpm from 'crpm';
import * as fs from 'fs';

export class CicdStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // IDE stack CloudFormation template S3 URL parameter
    const nestedStackTemplateUrlParameter = new cdk.CfnParameter(this, 'IdeStackTemplateURL', {
      type: 'String',
      description: 'IDE stack CloudFormation template S3 URL parameter'
    });
    
    // CloudFormation role
    // After this role has been used by the pipeline, it needs to stick around
    // until the very end when deleting the stack, because it will need to be
    // assumed to delete resources that were modified by the pipeline
    const cfnRoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-cloudformation/props.yaml`
    );
    const cfnRole = new iam.CfnRole(this, 'CloudFormationRole', cfnRoleProps);
    
    // S3 bucket
    // You can define an existing bucket to use by including artifact_bucket_name in context
    let artifactBucket;
    let artifactBucketName = this.node.tryGetContext('artifact_bucket_name');
    if (!artifactBucketName) {
      artifactBucket = new s3.CfnBucket(
        this,
        'Bucket',
        crpm.load<s3.CfnBucketProps>(`${__dirname}/../res/storage/s3/bucket-artifacts/props.yaml`)
      );
      artifactBucketName = artifactBucket.ref;
    }
    
    // Lambda role
    const fnRoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-lambda/props.yaml`
    );
    const fnRole = new iam.CfnRole(this, 'LambdaRole', fnRoleProps);
    // Make sure the CloudFormation role sticks around until the end
    fnRole.addDependsOn(cfnRole);
    
    // Lambda function
    const fnDir = `${__dirname}/../res/compute/lambda/function-custom-resource`;
    const fnProps = crpm.load<lambda.CfnFunctionProps>(`${fnDir}/props.yaml`);
    fnProps.code = {
      zipFile: fs.readFileSync(`${fnDir}/index.py`, 'utf8')
    }
    fnProps.role = fnRole.attrArn;
    const fn = new lambda.CfnFunction(this, 'Function', fnProps);
    
    // Custom resource
    const crProps = crpm.load<cfn.CfnCustomResourceProps>(
      `${__dirname}/../res/management-governance/cloudformation/custom-resource/props.yaml`
    );
    crProps.serviceToken = fn.attrArn;
    const cr = new cfn.CfnCustomResource(this, 'CustomResource', crProps);
    cr.addPropertyOverride('ArtifactBucketName', artifactBucketName);
    cr.addPropertyOverride('EmptyBucketOnDelete', artifactBucket != undefined);
    
    // CodeCommit repository
    const repoProps = crpm.load<codecommit.CfnRepositoryProps>(
      `${__dirname}/../res/developer-tools/codecommit/repository/props.yaml`
    );
    repoProps.repositoryName = cdk.Aws.STACK_NAME;
    (repoProps.code as any).s3.bucket = artifactBucketName;
    const repo = new codecommit.CfnRepository(this, 'Repository', repoProps);
    repo.addDependsOn(cr);
    
    // CodeBuild role
    const projectRoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-codebuild/props.yaml`
    );
    const projectRole = new iam.CfnRole(this, 'CodeBuildRole', projectRoleProps);
    
    // CodeBuild project
    const projectProps = crpm.load<codebuild.CfnProjectProps>(
      `${__dirname}/../res/developer-tools/codebuild/project/props.yaml`
    );
    projectProps.serviceRole = projectRole.attrArn;
    ((projectProps.environment as codebuild.CfnProject.EnvironmentProperty).environmentVariables as Array<codebuild.CfnProject.EnvironmentVariableProperty>) = [{
      name: 'IDE_STACK_TEMPLATE_URL',
      value: nestedStackTemplateUrlParameter.valueAsString
    }];
    const project = new codebuild.CfnProject(this, 'Project', projectProps);
    
    // CodePipeline role
    const pipelineRoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-codepipeline/props.yaml`
    );
    const pipelineRole = new iam.CfnRole(this, 'CodePipelineRole', pipelineRoleProps);
    
    // CodePipeline pipeline
    const pipelineProps = crpm.load<codepipeline.CfnPipelineProps>(
      `${__dirname}/../res/developer-tools/codepipeline/pipeline/props.yaml`
    );
    pipelineProps.roleArn = pipelineRole.attrArn;
    const stages = (pipelineProps.stages as any);
    stages[0].actions[0].configuration.RepositoryName = repo.attrName;
    stages[1].actions[0].configuration.ProjectName = project.ref;
    stages[2].actions[0].configuration.ParameterOverrides = cdk.Fn.join('', ['{"IdeStackTemplateURL": "', nestedStackTemplateUrlParameter.valueAsString, '"}']);
    stages[2].actions[0].configuration.RoleArn = cfnRole.attrArn;
    stages[2].actions[0].configuration.StackName = cdk.Aws.STACK_NAME;
    stages[3].actions[0].configuration.ParameterOverrides = stages[2].actions[0].configuration.ParameterOverrides;
    stages[3].actions[0].configuration.RoleArn = cfnRole.attrArn;
    stages[3].actions[0].configuration.StackName = cdk.Aws.STACK_NAME;
    pipelineProps.artifactStore = {
      location: artifactBucketName,
      type: 'S3'
    };
    const pipeline = new codepipeline.CfnPipeline(this, 'Pipeline', pipelineProps);
    
    // CloudWatch Events role
    const eventsRoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-events/props.yaml`
    );
    const eventsRole = new iam.CfnRole(this, 'EventsRole', eventsRoleProps);
    
    // CloudWatch Events rule
    const ruleProps = crpm.load<events.CfnRuleProps>(
      `${__dirname}/../res/management-governance/events/rule/props.yaml`
    );
    ruleProps.eventPattern.resources = [
      repo.attrArn
    ]
    const target = (ruleProps.targets as any)[0];
    target.arn = `arn:aws:codepipeline:${this.region}:${this.account}:${pipeline.ref}`;
    target.roleArn = eventsRole.attrArn;
    new events.CfnRule(this, 'Rule', ruleProps);
    
    // Nested CloudFormation stack
    const nestedStackProps = crpm.load<cfn.CfnStackProps>(`${__dirname}/../res/management-governance/cloudformation/stack/props.yaml`);
    nestedStackProps.templateUrl = nestedStackTemplateUrlParameter.valueAsString;
    nestedStackProps.parameters = {
      RepoName: repo.attrName
    };
    new cfn.CfnStack(this, 'Stack', nestedStackProps);
    
    // CodeCommit repository clone URL
    new cdk.CfnOutput(this, 'CodeCommitURL', {value: repo.attrCloneUrlHttp});
    
    // CodePipeline pipeline name
    new cdk.CfnOutput(this, 'CodePipelineName', {value: pipeline.ref});
    
    // CodePipeline pipeline version
    new cdk.CfnOutput(this, 'CodePipelineVersion', {value: pipeline.attrVersion});
  }
}
