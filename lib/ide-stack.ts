import * as cdk from '@aws-cdk/core';
import * as cfn from '@aws-cdk/aws-cloudformation';
import * as cloud9 from '@aws-cdk/aws-cloud9';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as ssm from '@aws-cdk/aws-ssm';
import * as crpm from 'crpm';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export class IdeStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // CodeCommit repository name parameter
    const repoNameParameter = new cdk.CfnParameter(this, 'RepoName', {
      type: 'String',
      description: 'CodeCommit repository name'
    });
    
    // Cloud9 environment
    const cloud9Props = crpm.load<cloud9.CfnEnvironmentEC2Props>(
      `${__dirname}/../res/developer-tools/cloud9/environment-ec2/props.yaml`
    );
    cloud9Props.name = cdk.Aws.STACK_NAME;
    cloud9Props.repositories[0].repositoryUrl = cdk.Fn.join('',
      [
        'https://git-codecommit.',
        this.region,
        '.amazonaws.com/v1/repos/',
        repoNameParameter.valueAsString
      ]
    );
    const c9 = new cloud9.CfnEnvironmentEC2(this, 'EnvironmentEC2', cloud9Props);
    
    // Cloud9 EC2 instance role
    const ec2RoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-ec2/props.yaml`
    );
    const ec2Role = new iam.CfnRole(this, 'EC2Role', ec2RoleProps);
    
    // Instance profile
    const instanceProfileProps = crpm.load<iam.CfnInstanceProfileProps>(
      `${__dirname}/../res/security-identity-compliance/iam/instance-profile-ide/props.yaml`
    );
    instanceProfileProps.roles = [ec2Role.ref];
    const instanceProfile = new iam.CfnInstanceProfile(this, 'InstanceProfile', instanceProfileProps);
    
    // Systems Manager document
    const ssmDocDir = `${__dirname}/../res/management-governance/ssm/document-configure-cloud9`;
    const ssmDocProps = crpm.load<ssm.CfnDocumentProps>(`${ssmDocDir}/props.yaml`);
    ssmDocProps.content = yaml.safeLoad(fs.readFileSync(`${ssmDocDir}/content.yaml`, 'utf8'));
    const ssmDoc = new ssm.CfnDocument(this, 'Document', ssmDocProps);
    
    // Lambda role
    const lambdaRoleProps = crpm.load<iam.CfnRoleProps>(
      `${__dirname}/../res/security-identity-compliance/iam/role-lambda/props.yaml`
    );
    const lambdaRole = new iam.CfnRole(this, 'LambdaRole', lambdaRoleProps);
    
    // Lambda function
    const fnDir = `${__dirname}/../res/compute/lambda/function-custom-resource-ide`;
    const fnProps = crpm.load<lambda.CfnFunctionProps>(`${fnDir}/props.yaml`);
    fnProps.code = {
      zipFile: fs.readFileSync(`${fnDir}/index.js`, 'utf8')
    }
    fnProps.role = lambdaRole.attrArn;
    const fn = new lambda.CfnFunction(this, 'Function', fnProps);
    
    // Custom resource
    const crProps = crpm.load<cfn.CfnCustomResourceProps>(
      `${__dirname}/../res/management-governance/cloudformation/custom-resource-ide/props.yaml`
    );
    crProps.serviceToken = fn.attrArn;
    const cr = new cfn.CfnCustomResource(this, 'CustomResource', crProps);
    cr.addPropertyOverride('cloud9EnvironmentId', c9.ref);
    cr.addPropertyOverride('instanceProfileName', instanceProfile.ref);
    cr.addPropertyOverride('ssmDocumentName', ssmDoc.ref);
    
    // Cloud9 environment name
    new cdk.CfnOutput(this, 'Cloud9EnvironmentName', {value: c9.attrName});
  }
}
